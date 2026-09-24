use crate::commands::{err, CmdResult};
use crate::models::{ArcaConfig, ArcaConfigInput, ElectronicInvoice, InvoiceInput};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use openssl::hash::MessageDigest;
use openssl::pkcs7::{Pkcs7, Pkcs7Flags};
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::stack::Stack;
use openssl::x509::{X509NameBuilder, X509Req, X509ReqBuilder, X509};
use rusqlite::params;
use tauri::State;

// ─── Endpoints ARCA ──────────────────────────────────────────────────────────

const WSAA_HOMO: &str = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const WSAA_PROD: &str = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const WSFEV1_HOMO: &str = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";
const WSFEV1_PROD: &str = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";

fn wsaa_url(env: &str) -> &'static str {
    if env == "prod" { WSAA_PROD } else { WSAA_HOMO }
}
fn wsfev1_url(env: &str) -> &'static str {
    if env == "prod" { WSFEV1_PROD } else { WSFEV1_HOMO }
}

fn cbte_tipo(invoice_type: &str) -> i64 {
    match invoice_type { "A" => 1, "B" => 6, "C" => 11, _ => 6 }
}

// Nota de Crédito del mismo tipo de letra que la factura que anula (tabla de
// tipos de comprobante de ARCA: 3=NC A, 8=NC B, 13=NC C).
fn nc_cbte_tipo(invoice_type: &str) -> i64 {
    match invoice_type { "A" => 3, "B" => 8, "C" => 13, _ => 8 }
}

// ─── Configuración ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_arca_config(state: State<AppState>) -> CmdResult<Option<ArcaConfig>> {
    let conn = state.db.lock();
    let row = conn.query_row(
        "SELECT cuit, razon_social, punto_venta, private_key_pem, certificate_pem, environment, token, token_expires_at, condicion_iva, domicilio, ingresos_brutos, inicio_actividades
         FROM arca_config WHERE id=1",
        [],
        |r| Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, String>(8)?,
            r.get::<_, Option<String>>(9)?,
            r.get::<_, Option<String>>(10)?,
            r.get::<_, Option<String>>(11)?,
        )),
    );
    match row {
        Err(_) => Ok(None),
        Ok((cuit, razon_social, punto_venta, private_key, certificate, environment, token, token_expires_at, condicion_iva, domicilio, ingresos_brutos, inicio_actividades)) => {
            if cuit.is_empty() { return Ok(None); }
            let token_valid = match &token_expires_at {
                None => false,
                Some(exp) => chrono::DateTime::parse_from_rfc3339(exp)
                    .map(|e| e > chrono::Utc::now()).unwrap_or(false),
            };
            Ok(Some(ArcaConfig {
                cuit,
                razon_social,
                punto_venta,
                has_certificate: private_key.is_some() && certificate.is_some(),
                environment: if environment == "prod" { "prod".to_string() } else { "homo".to_string() },
                token_valid,
                token_expires_at,
                condicion_iva,
                domicilio,
                ingresos_brutos,
                inicio_actividades,
            }))
        }
    }
}

#[tauri::command]
pub fn save_arca_config(input: ArcaConfigInput, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO arca_config (id, cuit, razon_social, punto_venta, environment, condicion_iva, domicilio, ingresos_brutos, inicio_actividades, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           cuit=excluded.cuit, razon_social=excluded.razon_social,
           punto_venta=excluded.punto_venta, environment=excluded.environment,
           condicion_iva=excluded.condicion_iva, domicilio=excluded.domicilio,
           ingresos_brutos=excluded.ingresos_brutos, inicio_actividades=excluded.inicio_actividades,
           updated_at=CURRENT_TIMESTAMP",
        params![
            input.cuit, input.razon_social, input.punto_venta, input.environment, input.condicion_iva, input.domicilio,
            input.ingresos_brutos, input.inicio_actividades,
        ],
    ).map_err(err)?;
    Ok(())
}

// ─── Certificado digital ──────────────────────────────────────────────────────

// Genera el par de claves RSA-2048 de esta PC (la privada nunca sale de acá)
// y arma el CSR (pedido de certificado) que hay que pegar en ARCA →
// Administración de Certificados Digitales → Nueva solicitud. ARCA devuelve
// un .crt que se carga después con load_arca_certificate.
#[tauri::command]
pub fn generate_arca_keypair(state: State<AppState>) -> CmdResult<String> {
    let (cuit, razon_social) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT cuit, razon_social FROM arca_config WHERE id=1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        ).map_err(|_| "Guardá primero el CUIT en el Paso 1.".to_string())?
    };
    if cuit.trim().is_empty() {
        return Err("Guardá primero el CUIT en el Paso 1.".to_string());
    }

    let rsa = Rsa::generate(2048).map_err(|e| format!("Error generando la clave RSA: {e}"))?;
    let pkey = PKey::from_rsa(rsa).map_err(err)?;

    let mut name_builder = X509NameBuilder::new().map_err(err)?;
    name_builder.append_entry_by_text("C", "AR").map_err(err)?;
    name_builder
        .append_entry_by_text("CN", razon_social.as_deref().unwrap_or(&cuit))
        .map_err(err)?;
    name_builder
        .append_entry_by_text("serialNumber", &format!("CUIT {cuit}"))
        .map_err(err)?;
    let name = name_builder.build();

    let mut req_builder = X509ReqBuilder::new().map_err(err)?;
    // PKCS#10 solo define la versión 0 -- sin esto, OpenSSL 3.2+ rechaza el
    // CSR al verificarlo ("unsupported version"). Mejor dejarlo explícito
    // que confiar en que el valor por defecto sea el correcto.
    req_builder.set_version(0).map_err(err)?;
    req_builder.set_subject_name(&name).map_err(err)?;
    req_builder.set_pubkey(&pkey).map_err(err)?;
    req_builder.sign(&pkey, MessageDigest::sha256()).map_err(err)?;
    let req: X509Req = req_builder.build();

    let csr_pem = String::from_utf8(req.to_pem().map_err(err)?).map_err(err)?;
    let key_pem = String::from_utf8(pkey.private_key_to_pem_pkcs8().map_err(err)?).map_err(err)?;

    let conn = state.db.lock();
    conn.execute(
        "UPDATE arca_config SET private_key_pem=?1, certificate_pem=NULL, token=NULL, sign=NULL, token_expires_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1",
        params![key_pem],
    ).map_err(err)?;

    Ok(csr_pem)
}

#[tauri::command]
pub fn load_arca_certificate(cert_pem: String, state: State<AppState>) -> CmdResult<String> {
    if !cert_pem.contains("-----BEGIN CERTIFICATE-----") {
        return Err("El archivo no parece ser un certificado PEM válido".into());
    }
    let conn = state.db.lock();
    let has_key: bool = conn.query_row(
        "SELECT private_key_pem IS NOT NULL FROM arca_config WHERE id=1", [], |r| r.get(0)
    ).unwrap_or(false);
    if !has_key {
        return Err("Generá primero el par de claves antes de cargar el certificado".into());
    }
    conn.execute(
        "UPDATE arca_config SET certificate_pem=?1, token=NULL, sign=NULL, token_expires_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=1",
        params![cert_pem],
    ).map_err(err)?;
    Ok("Certificado cargado correctamente".to_string())
}

// ─── WSAA — Autenticación ─────────────────────────────────────────────────────

fn build_tra_xml(service: &str) -> String {
    let now = chrono::Utc::now();
    let gen = (now - chrono::Duration::minutes(10)).format("%Y-%m-%dT%H:%M:%S");
    let exp = (now + chrono::Duration::minutes(10)).format("%Y-%m-%dT%H:%M:%S");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>{}</uniqueId>
    <generationTime>{}+00:00</generationTime>
    <expirationTime>{}+00:00</expirationTime>
  </header>
  <service>{}</service>
</loginTicketRequest>"#,
        now.timestamp(), gen, exp, service
    )
}

// Firma el TRA con el certificado que dio ARCA -- WSAA pide un CMS/PKCS#7
// "nodetach" (el contenido va embebido en la firma, no aparte) en base64.
// Es el mismo formato que da `openssl smime -sign -in TRA.xml -signer cert.crt
// -inkey key.key -nodetach -outform DER`, que es el comando que documenta ARCA.
fn sign_tra(tra: &str, cert_pem: &str, private_key_pem: &str) -> Result<String, String> {
    let cert = X509::from_pem(cert_pem.as_bytes()).map_err(|e| format!("Certificado ARCA inválido: {e}"))?;
    let pkey = PKey::private_key_from_pem(private_key_pem.as_bytes())
        .map_err(|e| format!("Clave privada ARCA inválida: {e}"))?;
    let empty_chain = Stack::new().map_err(err)?;
    // Sin el flag DETACHED el contenido queda embebido (equivalente a -nodetach).
    let pkcs7 = Pkcs7::sign(&cert, &pkey, &empty_chain, tra.as_bytes(), Pkcs7Flags::BINARY)
        .map_err(|e| format!("Error firmando el TRA: {e}"))?;
    let der = pkcs7.to_der().map_err(err)?;
    Ok(B64.encode(der))
}

// ARCA devuelve un "SOAP Fault" (con el motivo real del rechazo, ej. CUIT sin
// autorizar, CMS mal firmado, etc.) como HTTP 500 -- no como 200. `ureq`
// trata cualquier 4xx/5xx como Err por default y, sin este manejo, se perdía
// el cuerpo de la respuesta: quedaba solo "status code 500" sin poder saber
// nunca el motivo real. Con esto, un error HTTP también deja leer el cuerpo.
fn soap_post(url: &str, soap_action: &str, body: &str) -> Result<String, String> {
    let result = ureq::post(url)
        .set("Content-Type", "text/xml; charset=UTF-8")
        .set("SOAPAction", soap_action)
        .timeout(std::time::Duration::from_secs(30))
        .send_string(body);
    match result {
        Ok(resp) => resp.into_string().map_err(|e| format!("Error leyendo la respuesta de ARCA: {e}")),
        Err(ureq::Error::Status(_code, resp)) => resp
            .into_string()
            .map_err(|e| format!("Error leyendo la respuesta de error de ARCA: {e}")),
        Err(e) => Err(format!("Error conectando con ARCA: {e}")),
    }
}

fn call_wsaa(cms_b64: &str, env: &str) -> Result<(String, String, String), String> {
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>{}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>"#,
        cms_b64
    );
    let xml = soap_post(wsaa_url(env), "loginCms", &body)?;
    parse_wsaa_response(&xml)
}

fn parse_wsaa_response(xml: &str) -> Result<(String, String, String), String> {
    // ARCA devuelve el <loginTicketResponse> (con el token adentro) como texto
    // escapado dentro de <loginCmsReturn> -- "&lt;token&gt;", no "<token>" --
    // porque es un SOAP envolviendo un XML adentro de otro XML. Sin
    // "des-escapar" primero, la búsqueda de la etiqueta nunca la encuentra
    // aunque ARCA haya respondido perfectamente bien.
    let unescaped = xml_unescape(xml);

    if let Some(fault) = extract_xml_tag(&unescaped, "faultstring") {
        return Err(format!("ARCA rechazó la autenticación: {fault}"));
    }

    let token = extract_xml_tag(&unescaped, "token")
        .ok_or("ARCA WSAA: no se encontró el token en la respuesta")?;
    let sign = extract_xml_tag(&unescaped, "sign")
        .ok_or("ARCA WSAA: no se encontró el sign en la respuesta")?;
    let expiration = extract_xml_tag(&unescaped, "expirationTime")
        .ok_or("ARCA WSAA: no se encontró expirationTime en la respuesta")?;
    Ok((token, sign, expiration))
}

fn xml_unescape(s: &str) -> String {
    // El orden importa: &amp; tiene que ir último, si no "&lt;" (que ya tiene
    // un &) se reconvertiría mal al desescapar el amp suelto de otra entidad.
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn get_or_refresh_token(state: &AppState) -> Result<(String, String, String), String> {
    let (cert_pem, private_key_pem, environment, token, sign, token_expires_at) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT certificate_pem, private_key_pem, environment, token, sign, token_expires_at FROM arca_config WHERE id=1",
            [],
            |r| Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            )),
        ).map_err(|_| "No hay configuración ARCA.".to_string())?
    };

    let cert = cert_pem.ok_or("No hay certificado ARCA cargado.")?;
    let key = private_key_pem.ok_or("No hay clave privada ARCA.")?;

    // Token cacheado vigente
    if let (Some(t), Some(s), Some(exp)) = (&token, &sign, &token_expires_at) {
        let still_valid = chrono::DateTime::parse_from_rfc3339(exp)
            .map(|e| e > (chrono::Utc::now() + chrono::Duration::minutes(5)))
            .unwrap_or(false);
        if still_valid { return Ok((t.clone(), s.clone(), environment)); }
    }

    // "wsfe" es el nombre de servicio correcto para WSAA/WSASS -- "wsfev1"
    // NO existe como servicio autorizable (no aparece en el catálogo de
    // WSASS); es solo el nombre del endpoint SOAP más nuevo, no un servicio
    // de autorización distinto. (Antes probé cambiar esto a "wsfev1" por un
    // diagnóstico equivocado -- lo revierto.)
    let tra = build_tra_xml("wsfe");
    let cms = sign_tra(&tra, &cert, &key)?;
    let (new_token, new_sign, expiration) = call_wsaa(&cms, &environment)?;

    {
        let conn = state.db.lock();
        let _ = conn.execute(
            "UPDATE arca_config SET token=?1, sign=?2, token_expires_at=?3, updated_at=CURRENT_TIMESTAMP WHERE id=1",
            params![new_token, new_sign, expiration],
        );
    }
    Ok((new_token, new_sign, environment))
}

#[tauri::command]
pub fn test_arca_connection(state: State<AppState>) -> CmdResult<String> {
    get_or_refresh_token(&state)
        .map(|_| "Conexión con ARCA exitosa — token obtenido correctamente".to_string())
}

// ─── WSFEV1 — Emisión ────────────────────────────────────────────────────────

fn get_last_cbte_nro(cuit: &str, pv: i64, ct: i64, token: &str, sign: &str, env: &str) -> Result<i64, String> {
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth><ar:Token>{}</ar:Token><ar:Sign>{}</ar:Sign><ar:Cuit>{}</ar:Cuit></ar:Auth>
      <ar:PtoVta>{}</ar:PtoVta>
      <ar:CbteTipo>{}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>"#,
        token, sign, cuit, pv, ct
    );
    let xml = soap_post(wsfev1_url(env), "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado", &body)?;
    if let Some(fault) = extract_xml_tag(&xml, "faultstring") {
        return Err(format!("ARCA rechazó la consulta: {fault}"));
    }
    Ok(extract_xml_tag(&xml, "CbteNro").and_then(|s| s.parse().ok()).unwrap_or(0))
}

fn call_fecae_solicitar(
    cuit: &str, pv: i64, ct: i64, nro: i64,
    input: &InvoiceInput, token: &str, sign: &str, env: &str,
    cbte_asoc: Option<(i64, i64, i64)>,
) -> Result<(String, String), String> {
    let fecha = chrono::Local::now().format("%Y%m%d").to_string();
    let total = format!("{:.2}", input.total_cents as f64 / 100.0);
    let neto  = format!("{:.2}", input.neto_cents as f64 / 100.0);
    let iva   = format!("{:.2}", input.iva_cents as f64 / 100.0);
    let doc_nro = if input.doc_tipo == 99 { "0".to_string() } else { input.doc_nro.clone() };
    // RG 5616: toda factura debe declarar la condición IVA del receptor. El
    // valor lo decide el frontend (src/lib/facturacion.ts) según la condición
    // real del cliente -- acá solo se transmite tal cual, no se recalcula,
    // porque el mismo valor tiene que coincidir con lo que se imprime.
    let condicion_iva_receptor_id = input.condicion_iva_receptor_id;
    // Factura/NC A y B discriminan IVA (1,3=A; 6,8=B); C nunca (11,13).
    let iva_block = if matches!(ct, 1 | 3 | 6 | 8) {
        format!("<ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>{}</ar:BaseImp><ar:Importe>{}</ar:Importe></ar:AlicIva></ar:Iva>", neto, iva)
    } else { String::new() };
    // Nota de Crédito: tiene que referenciar el comprobante que anula
    // (Tipo/PtoVta/Nro de la factura original), si no ARCA la rechaza.
    let cbte_asoc_block = match cbte_asoc {
        Some((tipo, asoc_pv, asoc_nro)) => format!(
            "<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>{tipo}</ar:Tipo><ar:PtoVta>{asoc_pv}</ar:PtoVta><ar:Nro>{asoc_nro}</ar:Nro></ar:CbteAsoc></ar:CbtesAsoc>"
        ),
        None => String::new(),
    };

    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth><ar:Token>{token}</ar:Token><ar:Sign>{sign}</ar:Sign><ar:Cuit>{cuit}</ar:Cuit></ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>{pv}</ar:PtoVta><ar:CbteTipo>{ct}</ar:CbteTipo></ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>{doc_tipo}</ar:DocTipo><ar:DocNro>{doc_nro}</ar:DocNro>
            <ar:CbteDesde>{nro}</ar:CbteDesde><ar:CbteHasta>{nro}</ar:CbteHasta>
            <ar:CbteFch>{fecha}</ar:CbteFch>
            <ar:ImpTotal>{total}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>{neto}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>{iva}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>{condicion_iva_receptor_id}</ar:CondicionIVAReceptorId>
            {cbte_asoc_block}
            {iva_block}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>"#,
        token=token, sign=sign, cuit=cuit, pv=pv, ct=ct, nro=nro,
        doc_tipo=input.doc_tipo, doc_nro=doc_nro, fecha=fecha,
        total=total, neto=neto, iva=iva, iva_block=iva_block,
        condicion_iva_receptor_id=condicion_iva_receptor_id,
        cbte_asoc_block=cbte_asoc_block,
    );

    let xml = soap_post(wsfev1_url(env), "http://ar.gov.afip.dif.FEV1/FECAESolicitar", &body)?;
    if let Some(fault) = extract_xml_tag(&xml, "faultstring") {
        return Err(format!("ARCA rechazó la factura: {fault}"));
    }
    if xml.contains("<Resultado>R</Resultado>") {
        let obs = extract_xml_tag(&xml, "Msg").unwrap_or_else(|| "Error ARCA".to_string());
        return Err(format!("ARCA rechazó la factura: {}", obs));
    }
    let cae = extract_xml_tag(&xml, "CAE").ok_or("ARCA no devolvió CAE")?;
    let vto = extract_xml_tag(&xml, "CAEFchVto").unwrap_or_default();
    let cae_expires = if vto.len() == 8 {
        format!("{}-{}-{}", &vto[0..4], &vto[4..6], &vto[6..8])
    } else { vto };
    Ok((cae, cae_expires))
}

#[tauri::command]
pub fn issue_electronic_invoice(input: InvoiceInput, state: State<AppState>) -> CmdResult<ElectronicInvoice> {
    let (cuit, punto_venta, environment) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT cuit, punto_venta, environment FROM arca_config WHERE id=1",
            [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)),
        ).map_err(|_| "No hay configuración ARCA".to_string())?
    };
    let ct = cbte_tipo(&input.invoice_type);

    let inv_id = {
        let conn = state.db.lock();
        conn.execute(
            "INSERT INTO electronic_invoices
             (sale_id, invoice_type, cbte_tipo, punto_venta, total_cents, neto_cents, iva_cents,
              client_cuit, client_name, doc_tipo, concepto, condicion_iva_receptor_id, status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'pendiente')",
            params![
                input.sale_id, input.invoice_type, ct, punto_venta,
                input.total_cents, input.neto_cents, input.iva_cents,
                input.client_cuit, input.client_name, input.doc_tipo, input.concepto,
                input.condicion_iva_receptor_id,
            ],
        ).map_err(err)?;
        conn.last_insert_rowid()
    };

    let result: Result<(i64, String, String), String> = (|| {
        let (token, sign, env) = get_or_refresh_token(&state)?;
        let last = get_last_cbte_nro(&cuit, punto_venta, ct, &token, &sign, &env)?;
        let cbte_nro = last + 1;
        let (cae, exp) = call_fecae_solicitar(&cuit, punto_venta, ct, cbte_nro, &input, &token, &sign, &env, None)?;
        Ok((cbte_nro, cae, exp))
    })();

    {
        let conn = state.db.lock();
        match &result {
            Ok((cbte_nro, cae, cae_expires)) => {
                conn.execute(
                    "UPDATE electronic_invoices SET cbte_nro=?1, cae=?2, cae_expires_at=?3, status='autorizada' WHERE id=?4",
                    params![cbte_nro, cae, cae_expires, inv_id],
                ).map_err(err)?;
            }
            Err(e) => {
                conn.execute(
                    "UPDATE electronic_invoices SET status='error', error_msg=?1 WHERE id=?2",
                    params![e, inv_id],
                ).map_err(err)?;
            }
        }
    }
    fetch_invoice(&state, inv_id)
}

// Anula una factura autorizada emitiendo una Nota de Crédito del mismo tipo
// de letra (A/B/C) por el mismo importe. Es la ÚNICA forma de "borrar" una
// factura: ARCA no permite eliminar un comprobante que ya tiene CAE, ni acá
// ni en su propia web -- la Nota de Crédito es un comprobante nuevo que la
// revierte, no un borrado.
#[tauri::command]
pub fn issue_credit_note(invoice_id: i64, state: State<AppState>) -> CmdResult<ElectronicInvoice> {
    let original = fetch_invoice(&state, invoice_id)?;
    if original.status != "autorizada" {
        return Err("Solo se puede anular una factura autorizada.".to_string());
    }
    if original.credited_invoice_id.is_some() {
        return Err("Esto ya es una nota de crédito, no se puede anular de nuevo.".to_string());
    }
    {
        let conn = state.db.lock();
        let ya_anulada: Option<i64> = conn.query_row(
            "SELECT id FROM electronic_invoices WHERE credited_invoice_id=?1 AND status IN ('autorizada','pendiente') LIMIT 1",
            params![invoice_id], |r| r.get(0),
        ).ok();
        if ya_anulada.is_some() {
            return Err("Esta factura ya tiene una nota de crédito emitida.".to_string());
        }
    }

    let (cuit, punto_venta, environment) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT cuit, punto_venta, environment FROM arca_config WHERE id=1",
            [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)),
        ).map_err(|_| "No hay configuración ARCA".to_string())?
    };
    let nc_ct = nc_cbte_tipo(&original.invoice_type);
    let cbte_asoc = (original.cbte_tipo, original.punto_venta, original.cbte_nro.unwrap_or(0));

    let input = InvoiceInput {
        sale_id: None,
        invoice_type: original.invoice_type.clone(),
        total_cents: original.total_cents,
        neto_cents: original.neto_cents,
        iva_cents: original.iva_cents,
        client_cuit: original.client_cuit.clone(),
        client_name: original.client_name.clone(),
        doc_tipo: original.doc_tipo,
        doc_nro: original.client_cuit.clone().unwrap_or_else(|| "0".to_string()),
        concepto: Some(format!(
            "Anula Factura {} {}-{}",
            original.invoice_type,
            format!("{:04}", original.punto_venta),
            format!("{:08}", original.cbte_nro.unwrap_or(0)),
        )),
        condicion_iva_receptor_id: original.condicion_iva_receptor_id,
    };

    let inv_id = {
        let conn = state.db.lock();
        conn.execute(
            "INSERT INTO electronic_invoices
             (sale_id, invoice_type, cbte_tipo, punto_venta, total_cents, neto_cents, iva_cents,
              client_cuit, client_name, doc_tipo, concepto, condicion_iva_receptor_id, credited_invoice_id, status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'pendiente')",
            params![
                Option::<i64>::None, input.invoice_type, nc_ct, punto_venta,
                input.total_cents, input.neto_cents, input.iva_cents,
                input.client_cuit, input.client_name, input.doc_tipo, input.concepto,
                input.condicion_iva_receptor_id, invoice_id,
            ],
        ).map_err(err)?;
        conn.last_insert_rowid()
    };

    let result: Result<(i64, String, String), String> = (|| {
        let (token, sign, env) = get_or_refresh_token(&state)?;
        let last = get_last_cbte_nro(&cuit, punto_venta, nc_ct, &token, &sign, &env)?;
        let cbte_nro = last + 1;
        let (cae, exp) = call_fecae_solicitar(&cuit, punto_venta, nc_ct, cbte_nro, &input, &token, &sign, &env, Some(cbte_asoc))?;
        Ok((cbte_nro, cae, exp))
    })();

    {
        let conn = state.db.lock();
        match &result {
            Ok((cbte_nro, cae, cae_expires)) => {
                conn.execute(
                    "UPDATE electronic_invoices SET cbte_nro=?1, cae=?2, cae_expires_at=?3, status='autorizada' WHERE id=?4",
                    params![cbte_nro, cae, cae_expires, inv_id],
                ).map_err(err)?;
            }
            Err(e) => {
                conn.execute(
                    "UPDATE electronic_invoices SET status='error', error_msg=?1 WHERE id=?2",
                    params![e, inv_id],
                ).map_err(err)?;
            }
        }
    }
    fetch_invoice(&state, inv_id)
}

#[tauri::command]
pub fn list_electronic_invoices(limit: i64, state: State<AppState>) -> CmdResult<Vec<ElectronicInvoice>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, sale_id, invoice_type, cbte_tipo, punto_venta, cbte_nro, cae, cae_expires_at,
                total_cents, neto_cents, iva_cents, client_cuit, client_name, doc_tipo, status, error_msg, created_at, concepto, condicion_iva_receptor_id, credited_invoice_id
         FROM electronic_invoices ORDER BY created_at DESC LIMIT ?1"
    ).map_err(err)?;
    let x: Vec<ElectronicInvoice> = stmt.query_map(params![limit], row_to_invoice)
        .map_err(err)?.filter_map(|r| r.ok()).collect();
    Ok(x)
}

#[tauri::command]
pub fn retry_pending_invoices(state: State<AppState>) -> CmdResult<i64> {
    let pending_ids: Vec<i64> = {
        let conn = state.db.lock();
        let mut stmt = conn.prepare(
            "SELECT id FROM electronic_invoices WHERE status='pendiente' ORDER BY created_at ASC LIMIT 50"
        ).map_err(err)?;
        let x: Vec<i64> = stmt.query_map([], |r| r.get(0))
            .map_err(err)?.filter_map(|r| r.ok()).collect();
        x
    };
    if pending_ids.is_empty() { return Ok(0); }

    let (token, sign, environment) = match get_or_refresh_token(&state) {
        Ok(t) => t,
        Err(_) => return Ok(0),
    };
    let (cuit, punto_venta) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT cuit, punto_venta FROM arca_config WHERE id=1",
            [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        ).map_err(err)?
    };

    let mut processed = 0i64;
    for inv_id in pending_ids {
        let inv = match fetch_invoice(&state, inv_id) { Ok(i) => i, Err(_) => continue };
        // El código ya guardado en `cbte_tipo` es el correcto tanto para
        // facturas (1/6/11) como para notas de crédito (3/8/13) -- no
        // recalcularlo con cbte_tipo(), que solo conoce las facturas.
        let ct = inv.cbte_tipo;
        let cbte_asoc = inv.credited_invoice_id.and_then(|orig_id| {
            fetch_invoice(&state, orig_id).ok().map(|o| (o.cbte_tipo, o.punto_venta, o.cbte_nro.unwrap_or(0)))
        });
        let result: Result<(i64, String, String), String> = (|| {
            let last = get_last_cbte_nro(&cuit, punto_venta, ct, &token, &sign, &environment)?;
            let cbte_nro = last + 1;
            let input = InvoiceInput {
                sale_id: inv.sale_id, invoice_type: inv.invoice_type.clone(),
                total_cents: inv.total_cents, neto_cents: inv.neto_cents, iva_cents: inv.iva_cents,
                client_cuit: inv.client_cuit.clone(), client_name: inv.client_name.clone(),
                doc_tipo: inv.doc_tipo, doc_nro: inv.client_cuit.clone().unwrap_or_else(|| "0".to_string()),
                concepto: inv.concepto.clone(),
                condicion_iva_receptor_id: inv.condicion_iva_receptor_id,
            };
            let (cae, exp) = call_fecae_solicitar(&cuit, punto_venta, ct, cbte_nro, &input, &token, &sign, &environment, cbte_asoc)?;
            Ok((cbte_nro, cae, exp))
        })();
        let conn = state.db.lock();
        match result {
            Ok((cbte_nro, cae, exp)) => {
                let _ = conn.execute(
                    "UPDATE electronic_invoices SET cbte_nro=?1, cae=?2, cae_expires_at=?3, status='autorizada' WHERE id=?4",
                    params![cbte_nro, cae, exp, inv_id],
                );
                processed += 1;
            }
            Err(e) => { let _ = conn.execute("UPDATE electronic_invoices SET error_msg=?1 WHERE id=?2", params![e, inv_id]); }
        }
    }
    Ok(processed)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn fetch_invoice(state: &AppState, id: i64) -> CmdResult<ElectronicInvoice> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, sale_id, invoice_type, cbte_tipo, punto_venta, cbte_nro, cae, cae_expires_at,
                total_cents, neto_cents, iva_cents, client_cuit, client_name, doc_tipo, status, error_msg, created_at, concepto, condicion_iva_receptor_id, credited_invoice_id
         FROM electronic_invoices WHERE id=?1"
    ).map_err(err)?;
    stmt.query_row(params![id], row_to_invoice).map_err(err)
}

fn row_to_invoice(row: &rusqlite::Row) -> rusqlite::Result<ElectronicInvoice> {
    Ok(ElectronicInvoice {
        id: row.get(0)?, sale_id: row.get(1)?,
        invoice_type: row.get(2)?, cbte_tipo: row.get(3)?, punto_venta: row.get(4)?,
        cbte_nro: row.get(5)?, cae: row.get(6)?, cae_expires_at: row.get(7)?,
        total_cents: row.get(8)?, neto_cents: row.get(9)?, iva_cents: row.get(10)?,
        client_cuit: row.get(11)?, client_name: row.get(12)?, doc_tipo: row.get(13)?,
        status: row.get(14)?, error_msg: row.get(15)?, created_at: row.get(16)?,
        concepto: row.get(17)?, condicion_iva_receptor_id: row.get(18)?,
        credited_invoice_id: row.get(19)?,
    })
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].trim().to_string())
}

// ─── Tests: no llaman a ARCA -- verifican que el CSR y la firma PKCS#7 que
// arma este código son estructuralmente válidos (sin esto no hay forma de
// saber si compila Y funciona, ya que probar contra ARCA de verdad requiere
// un CUIT y un certificado reales que solo la dueña del comercio tiene).
#[cfg(test)]
mod tests {
    use super::*;
    use openssl::asn1::Asn1Time;
    use openssl::pkcs7::Pkcs7;
    use openssl::x509::X509Builder;

    #[test]
    fn csr_generation_produces_valid_pkcs10() {
        let rsa = Rsa::generate(2048).unwrap();
        let pkey = PKey::from_rsa(rsa).unwrap();

        let mut name_builder = X509NameBuilder::new().unwrap();
        name_builder.append_entry_by_text("C", "AR").unwrap();
        name_builder.append_entry_by_text("CN", "Kiosco de Prueba").unwrap();
        name_builder.append_entry_by_text("serialNumber", "CUIT 20111111112").unwrap();
        let name = name_builder.build();

        let mut req_builder = X509ReqBuilder::new().unwrap();
        req_builder.set_version(0).unwrap();
        req_builder.set_subject_name(&name).unwrap();
        req_builder.set_pubkey(&pkey).unwrap();
        req_builder.sign(&pkey, MessageDigest::sha256()).unwrap();
        let req = req_builder.build();

        // Un CSR mal armado no pasa su propia verificación de firma.
        assert!(req.verify(&pkey).unwrap(), "el CSR generado no pasa su propia verificación de firma");
        let pem = req.to_pem().unwrap();
        assert!(String::from_utf8(pem).unwrap().contains("BEGIN CERTIFICATE REQUEST"));
    }

    #[test]
    fn sign_tra_produces_valid_detached_free_pkcs7() {
        // Arma un certificado autofirmado SOLO para probar la firma en este
        // test -- ARCA jamás va a confiar en este certificado, pero sirve
        // para confirmar que sign_tra arma un CMS/PKCS7 bien formado.
        let rsa = Rsa::generate(2048).unwrap();
        let pkey = PKey::from_rsa(rsa).unwrap();

        let mut name_builder = X509NameBuilder::new().unwrap();
        name_builder.append_entry_by_text("C", "AR").unwrap();
        name_builder.append_entry_by_text("CN", "Test").unwrap();
        let name = name_builder.build();

        let mut cert_builder = X509Builder::new().unwrap();
        cert_builder.set_subject_name(&name).unwrap();
        cert_builder.set_issuer_name(&name).unwrap();
        cert_builder.set_pubkey(&pkey).unwrap();
        cert_builder.set_not_before(&Asn1Time::days_from_now(0).unwrap()).unwrap();
        cert_builder.set_not_after(&Asn1Time::days_from_now(365).unwrap()).unwrap();
        cert_builder.sign(&pkey, MessageDigest::sha256()).unwrap();
        let cert = cert_builder.build();

        let cert_pem = String::from_utf8(cert.to_pem().unwrap()).unwrap();
        let key_pem = String::from_utf8(pkey.private_key_to_pem_pkcs8().unwrap()).unwrap();

        let tra = build_tra_xml("wsfe");
        let cms_b64 = sign_tra(&tra, &cert_pem, &key_pem).expect("sign_tra falló");

        // Si el base64/DER estuviera mal armado, esto ya explota acá.
        let der = B64.decode(&cms_b64).expect("la firma no es base64 válido");
        let pkcs7 = Pkcs7::from_der(&der).expect("el resultado no es un PKCS7/CMS válido");

        // El contenido tiene que venir embebido (nodetach) para que WSAA lo acepte.
        let mut out = Vec::new();
        let store = openssl::x509::store::X509StoreBuilder::new().unwrap().build();
        let mut certs_stack = Stack::new().unwrap();
        certs_stack.push(cert.clone()).unwrap();
        // NOVERIFY porque el cert es autofirmado (no hay cadena real acá);
        // lo que importa es que el contenido esté embebido y se recupere igual.
        pkcs7
            .verify(&certs_stack, &store, None, Some(&mut out), Pkcs7Flags::NOVERIFY)
            .expect("el PKCS7 generado no se pudo verificar/leer");
        assert_eq!(String::from_utf8(out).unwrap(), tra, "el TRA recuperado del PKCS7 no coincide con el original");
    }
}
