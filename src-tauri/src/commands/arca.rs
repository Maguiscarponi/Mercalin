use crate::commands::{audit::log_action, err, require_role, CmdResult};
use crate::models::{ArcaCheck, ArcaConfig, ArcaConfigInput, ArcaDiagnosis, ElectronicInvoice, InvoiceInput};
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
        "SELECT cuit, razon_social, punto_venta, private_key_pem, certificate_pem, environment, token, token_expires_at, condicion_iva, domicilio, ingresos_brutos, inicio_actividades, emision_automatica
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
            r.get::<_, i64>(12)?,
        )),
    );
    match row {
        Err(_) => Ok(None),
        Ok((cuit, razon_social, punto_venta, private_key, certificate, environment, token, token_expires_at, condicion_iva, domicilio, ingresos_brutos, inicio_actividades, emision_automatica)) => {
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
                emision_automatica: emision_automatica != 0,
            }))
        }
    }
}

#[tauri::command]
pub fn save_arca_config(input: ArcaConfigInput, session_token: Option<String>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    // Encontrado en la auditoría: guardar la configuración de ARCA (CUIT,
    // razón social, punto de venta, condición de IVA del negocio) no
    // requería ningún rol del lado del servidor ni quedaba registrado en
    // Auditoría, pese a ser uno de los datos más sensibles del sistema
    // (de acá depende qué factura se emite y a nombre de quién).
    let actor_id = Some(require_role(&conn, &state.sessions, session_token.as_deref(), "supervisor")?);
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
    log_action(&conn, actor_id, "editar", "arca_config", None, Some(&format!("CUIT: {}, razón social: {}", input.cuit, input.razon_social.as_deref().unwrap_or("—"))));
    Ok(())
}

// Automática (la factura se emite sola al cobrar en Caja) o manual (solo
// cuando se toca "Facturar" en la pantalla de venta confirmada). Va aparte de
// save_arca_config para cambiarlo con un clic, sin reenviar los datos fiscales.
#[tauri::command]
pub fn set_arca_emision_automatica(enabled: bool, session_token: Option<String>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    let actor_id = Some(require_role(&conn, &state.sessions, session_token.as_deref(), "supervisor")?);
    let changed = conn.execute(
        "UPDATE arca_config SET emision_automatica=?1, updated_at=CURRENT_TIMESTAMP WHERE id=1",
        params![enabled as i64],
    ).map_err(err)?;
    if changed == 0 {
        return Err("Primero completá y guardá tus datos de ARCA (Paso 1).".to_string());
    }
    let detalle = if enabled { "Facturación automática: se factura cada venta al cobrar" } else { "Facturación manual: solo cuando se toca \"Facturar\"" };
    log_action(&conn, actor_id, "editar", "arca_config", None, Some(detalle));
    Ok(())
}

// Borra la configuración de ARCA (CUIT, certificado, clave privada, token) y
// todo el historial de comprobantes emitidos -- vuelve al estado "recién
// instalado". Pensado para descartar pruebas en Testing antes de pasar a
// Producción, o para arrancar de cero si algo quedó mal cargado. No toca
// nada del lado de ARCA (eso es imposible de todos modos): solo borra lo
// que hay guardado localmente en esta base.
#[tauri::command]
pub fn reset_arca_data(session_token: Option<String>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    // Encontrado en la auditoría: borra TODO el historial real de facturas
    // autorizadas (CAE incluido) sin ningún control de rol ni de auditoría --
    // se exige admin específicamente (más estricto que el resto de ARCA, que
    // alcanza con supervisor) por ser irreversible y perder trazabilidad
    // fiscal real.
    let actor_id = Some(require_role(&conn, &state.sessions, session_token.as_deref(), "admin")?);
    let invoice_count: i64 = conn.query_row("SELECT COUNT(*) FROM electronic_invoices WHERE status='autorizada'", [], |r| r.get(0)).unwrap_or(0);
    log_action(&conn, actor_id, "eliminar", "arca_config", None, Some(&format!("Reseteo de ARCA: se perdió el historial de {} factura(s) autorizada(s)", invoice_count)));
    conn.execute("DELETE FROM electronic_invoices", []).map_err(err)?;
    conn.execute("DELETE FROM arca_config", []).map_err(err)?;
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
    // Trampa común: tocar "Generar de nuevo" después de haber pedido el
    // certificado en ARCA. El archivo que baja ARCA corresponde a la clave
    // vieja y ARCA lo rechaza recién al facturar, con un error de firma que
    // no dice nada. Mejor avisarlo acá, en el momento de cargarlo.
    let key_pem: String = conn.query_row("SELECT private_key_pem FROM arca_config WHERE id=1", [], |r| r.get(0)).map_err(err)?;
    if !cert_matches_key(&cert_pem, &key_pem) {
        return Err("Este certificado no corresponde a la clave generada en esta computadora. Pasa si tocaste \"Generar de nuevo\" después de pedirlo en ARCA, o si es un archivo de otra compu. Descargá de nuevo el archivo mercalin.csr, cargalo en ARCA en un alias nuevo y subí acá el certificado que te dé.".into());
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
        // El texto de ARCA solo ("Computador no autorizado a acceder al
        // servicio") no le dice nada a un comerciante: se le agrega qué hacer.
        let ayuda = match classify_wsaa_error(&fault) {
            "no_autorizado" => " — A Mercalin le falta el permiso para facturar a tu nombre. Se da una sola vez en la página de ARCA: andá a Facturación → Configuración ARCA → paso 3 y seguí el \"Trámite A\".",
            _ => "",
        };
        return Err(format!("ARCA rechazó la autenticación: {fault}{ayuda}"));
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

// ─── Revisión de la configuración ────────────────────────────────────────────
//
// "Probar conexión" solo decía si anduvo o no. Probando con un CUIT real, la
// dueña se trabó en tres lugares distintos (certificado, permiso en ARCA y
// punto de venta) y cada vez el cartel era el texto crudo de ARCA. Esta
// revisión mira las tres cosas por separado y le dice a la pantalla cuál
// falta, para que muestre los pasos de ESE trámite y no de todos.

fn check(estado: &str, codigo: &str, detalle: impl Into<String>) -> ArcaCheck {
    ArcaCheck { estado: estado.to_string(), codigo: codigo.to_string(), detalle: detalle.into() }
}

fn cert_matches_key(cert_pem: &str, key_pem: &str) -> bool {
    let (Ok(cert), Ok(key)) = (X509::from_pem(cert_pem.as_bytes()), PKey::private_key_from_pem(key_pem.as_bytes())) else {
        return false;
    };
    cert.public_key().map(|pk| pk.public_eq(&key)).unwrap_or(false)
}

fn cert_expired(cert_pem: &str) -> bool {
    let Ok(cert) = X509::from_pem(cert_pem.as_bytes()) else { return false };
    openssl::asn1::Asn1Time::days_from_now(0)
        .map(|now| cert.not_after() < now)
        .unwrap_or(false)
}

// Motivo de un rechazo de WSAA (el servicio de ARCA que da el permiso para
// usar los demás), a partir del texto que devuelve. El orden importa: "no
// autorizado" va primero porque es, por lejos, el caso más común.
fn classify_wsaa_error(msg: &str) -> &'static str {
    let m = msg.to_lowercase();
    if is_connectivity_error(msg) { "sin_internet" }
    else if m.contains("no autorizado") || m.contains("notauthorized") { "no_autorizado" }
    else if m.contains("ya posee un ta") || m.contains("alreadyauthenticated") { "ya_tiene_permiso" }
    else if m.contains("expirado") || m.contains("cert.expired") { "certificado_vencido" }
    else if m.contains("confianza") || m.contains("untrusted") { "certificado_ajeno" }
    else if m.contains("generationtime") || m.contains("expirationtime") { "reloj" }
    else if m.contains("firma") || m.contains("sign.invalid") || m.contains("cms") { "certificado_no_coincide" }
    else { "otro" }
}

fn evaluar_autorizacion(resultado: &Result<(), String>) -> ArcaCheck {
    let Err(e) = resultado else {
        return check("ok", "ok", "ARCA le dio permiso a Mercalin para facturar a tu nombre.");
    };
    let codigo = classify_wsaa_error(e);
    let detalle = match codigo {
        "sin_internet" => "No se pudo llegar a ARCA. Revisá que esta computadora tenga internet y volvé a probar. A veces la página de ARCA se cae un rato: si tenés internet, esperá unos minutos.".to_string(),
        "no_autorizado" => "El certificado está bien, pero ARCA todavía no le dio permiso a Mercalin para facturar. Falta hacer el Trámite A.".to_string(),
        "ya_tiene_permiso" => "ARCA dice que ya dio un permiso hace muy poco y no quiere dar otro todavía. No es un error tuyo: esperá 10 minutos y volvé a tocar el botón.".to_string(),
        "certificado_vencido" => "El certificado venció (duran dos años). Hay que pedir uno nuevo: volvé al paso 2 y hacelo otra vez.".to_string(),
        "certificado_ajeno" => "ARCA no reconoce este certificado. Tiene que ser el que se descarga de \"Administración de Certificados Digitales\". Volvé al paso 2 y hacelo de nuevo.".to_string(),
        "reloj" => "La fecha o la hora de esta computadora están mal y ARCA rechaza el pedido. Poné la hora automática en Windows (clic derecho en el reloj de abajo a la derecha → \"Ajustar fecha y hora\") y volvé a probar.".to_string(),
        "certificado_no_coincide" => "El certificado no corresponde a la clave de esta computadora. Volvé al paso 2 y hacelo de nuevo, sin tocar \"Generar de nuevo\" después de descargar el archivo.".to_string(),
        _ => format!("ARCA contestó algo que Mercalin no conoce: {e}"),
    };
    let estado = if matches!(codigo, "sin_internet" | "ya_tiene_permiso") { "duda" } else { "falta" };
    check(estado, codigo, detalle)
}

// Puntos de venta habilitados para Web Services según FEParamGetPtosVenta
// (los bloqueados o dados de baja no cuentan).
fn parse_ptos_venta(xml: &str) -> Vec<i64> {
    let mut out = Vec::new();
    let mut resto = xml;
    while let Some(bloque) = extract_xml_tag(resto, "PtoVenta") {
        let hasta = resto.find("</PtoVenta>").map(|i| i + "</PtoVenta>".len()).unwrap_or(resto.len());
        let bloqueado = extract_xml_tag(&bloque, "Bloqueado").map(|b| b.eq_ignore_ascii_case("S")).unwrap_or(false);
        let baja = extract_xml_tag(&bloque, "FchBaja").map(|f| !f.is_empty() && !f.eq_ignore_ascii_case("NULL")).unwrap_or(false);
        if let Some(nro) = extract_xml_tag(&bloque, "Nro").and_then(|n| n.parse::<i64>().ok()) {
            if !bloqueado && !baja && !out.contains(&nro) { out.push(nro); }
        }
        resto = &resto[hasta..];
    }
    out.sort_unstable();
    out
}

fn get_ptos_venta_ws(cuit: &str, token: &str, sign: &str, env: &str) -> Result<Vec<i64>, String> {
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FEParamGetPtosVenta>
      <ar:Auth><ar:Token>{}</ar:Token><ar:Sign>{}</ar:Sign><ar:Cuit>{}</ar:Cuit></ar:Auth>
    </ar:FEParamGetPtosVenta>
  </soapenv:Body>
</soapenv:Envelope>"#,
        token, sign, cuit
    );
    let xml = soap_post(wsfev1_url(env), "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta", &body)?;
    if let Some(fault) = extract_xml_tag(&xml, "faultstring") {
        return Err(format!("ARCA rechazó la consulta: {fault}"));
    }
    Ok(parse_ptos_venta(&xml))
}

// Veredicto sobre el punto de venta configurado, con dos fuentes: la lista
// que da ARCA de los que sirven para Web Services y la consulta del último
// comprobante de ese punto de venta (la misma que se hace antes de facturar).
// La lista manda cuando viene con algo; si viene vacía se mira la consulta.
fn evaluar_punto_venta(pv: i64, lista: &Result<Vec<i64>, String>, ultimo: &Result<i64, String>) -> ArcaCheck {
    let sin_internet = |e: &String| is_connectivity_error(e);
    if lista.as_ref().err().map(sin_internet).unwrap_or(false) || ultimo.as_ref().err().map(sin_internet).unwrap_or(false) {
        return check("duda", "sin_internet", "No se pudo llegar a ARCA para revisar el punto de venta. Revisá el internet y volvé a probar.");
    }
    let disponibles = lista.as_ref().map(|l| l.as_slice()).unwrap_or(&[]);
    if disponibles.contains(&pv) {
        return check("ok", "ok", format!("El punto de venta {pv} sirve para facturar desde Mercalin."));
    }
    if !disponibles.is_empty() {
        let lista_txt = disponibles.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(", ");
        return check("falta", "no_sirve", format!(
            "El punto de venta {pv} no sirve para facturar desde un sistema. Según ARCA, el que sirve es: {lista_txt}. Elegilo acá abajo."
        ));
    }
    match ultimo {
        Err(e) => check("falta", "ninguno", format!(
            "El punto de venta {pv} no sirve para facturar desde Mercalin y ARCA no informa ninguno que sirva. Hay que crear uno nuevo: es el Trámite B. (ARCA dijo: {})",
            e.trim_start_matches("ARCA rechazó la factura: ").trim_start_matches("ARCA rechazó la consulta: ")
        )),
        Ok(_) => check("duda", "sin_confirmar", format!(
            "ARCA no nos mostró la lista de puntos de venta, así que no pudimos confirmar si el {pv} sirve. Si lo creaste recién, esperá 10 minutos y volvé a revisar. Si no, miralo vos siguiendo el Trámite B: tiene que decir \"Web Services\"."
        )),
    }
}

#[tauri::command]
pub fn diagnose_arca(state: State<AppState>) -> CmdResult<ArcaDiagnosis> {
    let fila = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT cuit, punto_venta, condicion_iva, private_key_pem, certificate_pem FROM arca_config WHERE id=1",
            [],
            |r| Ok((
                r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?,
            )),
        ).ok()
    };
    let sin_probar = |motivo: &str| check("sin_probar", "sin_probar", motivo);
    let Some((cuit, pv, condicion_iva, key_pem, cert_pem)) = fila.filter(|f| !f.0.trim().is_empty()) else {
        return Ok(ArcaDiagnosis {
            certificado: check("falta", "sin_datos", "Todavía no cargaste tus datos. Empezá por el paso 1."),
            autorizacion: sin_probar("Se revisa cuando esté lo de arriba."),
            punto_venta: sin_probar("Se revisa cuando esté lo de arriba."),
            punto_venta_configurado: 0,
            puntos_venta_ws: vec![],
        });
    };

    let certificado = match (&key_pem, &cert_pem) {
        (Some(k), Some(c)) if !cert_matches_key(c, k) => check("falta", "certificado_no_coincide",
            "El certificado cargado no corresponde a la clave de esta computadora. Volvé al paso 2 y hacelo de nuevo."),
        (Some(_), Some(c)) if cert_expired(c) => check("falta", "certificado_vencido",
            "El certificado venció (duran dos años). Volvé al paso 2 y pedí uno nuevo."),
        (Some(_), Some(_)) => check("ok", "ok", "El certificado está cargado en Mercalin."),
        _ => check("falta", "sin_certificado", "Todavía no cargaste el certificado. Es el paso 2."),
    };
    if certificado.estado != "ok" {
        return Ok(ArcaDiagnosis {
            certificado,
            autorizacion: sin_probar("Se revisa cuando el certificado esté bien."),
            punto_venta: sin_probar("Se revisa cuando el certificado esté bien."),
            punto_venta_configurado: pv,
            puntos_venta_ws: vec![],
        });
    }

    let acceso = get_or_refresh_token(&state);
    let autorizacion = evaluar_autorizacion(&acceso.as_ref().map(|_| ()).map_err(|e| e.clone()));
    let Ok((token, sign, env)) = acceso else {
        return Ok(ArcaDiagnosis {
            certificado, autorizacion,
            punto_venta: sin_probar("Se revisa cuando ARCA le dé permiso a Mercalin."),
            punto_venta_configurado: pv,
            puntos_venta_ws: vec![],
        });
    };

    let lista = get_ptos_venta_ws(&cuit, &token, &sign, &env);
    let tipo = if condicion_iva == "responsable_inscripto" { cbte_tipo("B") } else { cbte_tipo("C") };
    let ultimo = get_last_cbte_nro(&cuit, pv, tipo, &token, &sign, &env);
    Ok(ArcaDiagnosis {
        certificado, autorizacion,
        punto_venta: evaluar_punto_venta(pv, &lista, &ultimo),
        punto_venta_configurado: pv,
        puntos_venta_ws: lista.unwrap_or_default(),
    })
}

// Cambia solo el punto de venta, sin reenviar el resto de los datos fiscales
// (para elegirlo con un clic entre los que ARCA informa que sirven).
#[tauri::command]
pub fn set_arca_punto_venta(punto_venta: i64, session_token: Option<String>, state: State<AppState>) -> CmdResult<()> {
    if !(1..=99998).contains(&punto_venta) {
        return Err("El punto de venta tiene que ser un número entre 1 y 99998.".to_string());
    }
    let conn = state.db.lock();
    let actor_id = Some(require_role(&conn, &state.sessions, session_token.as_deref(), "supervisor")?);
    let changed = conn.execute(
        "UPDATE arca_config SET punto_venta=?1, updated_at=CURRENT_TIMESTAMP WHERE id=1",
        params![punto_venta],
    ).map_err(err)?;
    if changed == 0 {
        return Err("Primero completá y guardá tus datos de ARCA (Paso 1).".to_string());
    }
    log_action(&conn, actor_id, "editar", "arca_config", None, Some(&format!("Punto de venta para facturar: {punto_venta}")));
    Ok(())
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
    // Un punto de venta que no es de Web Services no da SOAP Fault: responde
    // 200 con <Errors>. Sin este corte se seguía de largo con el número 0 y el
    // rechazo aparecía recién al pedir el CAE, con un motivo menos claro.
    if xml.contains("<Errors>") {
        return Err(format!("ARCA rechazó la factura: {}", arca_rejection_reason(&xml)));
    }
    Ok(extract_xml_tag(&xml, "CbteNro").and_then(|s| s.parse().ok()).unwrap_or(0))
}

// CAE con el que ARCA tiene registrado un comprobante (None si no existe).
fn consultar_cae(cuit: &str, pv: i64, ct: i64, nro: i64, token: &str, sign: &str, env: &str) -> Result<Option<String>, String> {
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompConsultar>
      <ar:Auth><ar:Token>{}</ar:Token><ar:Sign>{}</ar:Sign><ar:Cuit>{}</ar:Cuit></ar:Auth>
      <ar:FeCompConsReq><ar:CbteTipo>{}</ar:CbteTipo><ar:CbteNro>{}</ar:CbteNro><ar:PtoVta>{}</ar:PtoVta></ar:FeCompConsReq>
    </ar:FECompConsultar>
  </soapenv:Body>
</soapenv:Envelope>"#,
        token, sign, cuit, ct, nro, pv
    );
    let xml = soap_post(wsfev1_url(env), "http://ar.gov.afip.dif.FEV1/FECompConsultar", &body)?;
    Ok(extract_xml_tag(&xml, "CodAutorizacion"))
}

// Punto de venta con el que ARCA tiene de verdad la factura que se quiere
// anular: el guardado en la fila o, si no coincide el CAE, el configurado hoy.
fn locate_original_in_arca(state: &AppState, original: &ElectronicInvoice, cuit: &str, config_pv: i64) -> Result<i64, String> {
    let (Some(nro), Some(cae)) = (original.cbte_nro, original.cae.as_deref()) else {
        return Err("Esta factura no tiene número o CAE guardado, no se puede anular desde acá.".to_string());
    };
    let (token, sign, env) = get_or_refresh_token(state)?;
    let mut candidatos = vec![original.punto_venta];
    if config_pv != original.punto_venta { candidatos.push(config_pv); }
    for pv in candidatos {
        if consultar_cae(cuit, pv, original.cbte_tipo, nro, &token, &sign, &env)?.as_deref() == Some(cae) {
            return Ok(pv);
        }
    }
    Err("No se anuló nada: ARCA no tiene registrada esta factura con ese punto de venta y número. Escribinos por WhatsApp antes de volver a intentar.".to_string())
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
    if xml.contains("<Resultado>R</Resultado>") || (xml.contains("<Errors>") && !xml.contains("<CAE>")) {
        return Err(format!("ARCA rechazó la factura: {}", arca_rejection_reason(&xml)));
    }
    let cae = extract_xml_tag(&xml, "CAE").ok_or("ARCA no devolvió CAE")?;
    let vto = extract_xml_tag(&xml, "CAEFchVto").unwrap_or_default();
    let cae_expires = if vto.len() == 8 {
        format!("{}-{}-{}", &vto[0..4], &vto[4..6], &vto[6..8])
    } else { vto };
    Ok((cae, cae_expires))
}

// Encontrado en la auditoría: Facturación decide Factura A/B/C por reglas de
// negocio (condición de IVA), pero el tipo de documento del receptor (CUIT
// vs. DNI) lo decidía el frontend solo por la LONGITUD del texto ingresado,
// sin ninguna validación cruzada del lado del servidor -- una Factura A con
// un documento que no es un CUIT de 11 dígitos podía llegar a pedirse.
fn validate_invoice_input(input: &InvoiceInput) -> CmdResult<()> {
    if input.invoice_type == "A" {
        let digits_only = input.doc_nro.chars().all(|c| c.is_ascii_digit());
        if input.doc_tipo != 80 || input.doc_nro.len() != 11 || !digits_only {
            return Err("Una Factura A necesita el CUIT del receptor (11 dígitos), no un DNI.".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn issue_electronic_invoice(input: InvoiceInput, state: State<AppState>) -> CmdResult<ElectronicInvoice> {
    validate_invoice_input(&input)?;

    let (cuit, punto_venta, environment) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT cuit, punto_venta, environment FROM arca_config WHERE id=1",
            [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)),
        ).map_err(|_| "No hay configuración ARCA".to_string())?
    };
    let ct = cbte_tipo(&input.invoice_type);

    // Encontrado en la auditoría: si ARCA tardaba más de lo que espera la app
    // pero en realidad terminó autorizando la factura, "Reintentar" emitía un
    // segundo comprobante real -- un CAE fantasma que la app nunca vio. Antes
    // de intentar de nuevo, se chequea si esta venta ya tiene una factura
    // autorizada en el propio historial.
    if let Some(sid) = input.sale_id {
        let conn = state.db.lock();
        let existing_id: Option<i64> = conn.query_row(
            "SELECT id FROM electronic_invoices WHERE sale_id=?1 AND status='autorizada' AND credited_invoice_id IS NULL LIMIT 1",
            params![sid], |r| r.get(0),
        ).ok();
        if let Some(id) = existing_id {
            drop(conn);
            return fetch_invoice(&state, id);
        }
    }

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
                let status = if is_connectivity_error(e) { "pendiente" } else { "error" };
                conn.execute(
                    "UPDATE electronic_invoices SET status=?1, error_msg=?2 WHERE id=?3",
                    params![status, e, inv_id],
                ).map_err(err)?;
            }
        }
    }
    fetch_invoice(&state, inv_id)
}

// Anula una factura autorizada emitiendo una Nota de Crédito del mismo tipo
// de letra (A/B/C). Es la ÚNICA forma de "borrar" una factura: ARCA no
// permite eliminar un comprobante que ya tiene CAE, ni acá ni en su propia
// web -- la Nota de Crédito es un comprobante nuevo que la revierte, no un
// borrado.
//
// `amount_cents`/`return_id` son para devoluciones parciales (ver Devoluciones):
// cuando vienen, la NC es solo por lo devuelto (no por el total de la
// factura), el neto/IVA se recalculan proporcionalmente, y el chequeo de
// "ya tiene NC" se hace por devolución puntual en vez de por factura entera
// -- así una misma venta puede tener varias devoluciones parciales, cada una
// con su propia NC, sin que la primera bloquee a las siguientes. Cuando no
// vienen (anulación manual desde Facturación), es una anulación total como
// siempre fue: por el importe completo y solo se puede hacer una vez.
#[tauri::command]
pub fn issue_credit_note(
    invoice_id: i64,
    amount_cents: Option<i64>,
    return_id: Option<i64>,
    state: State<AppState>,
) -> CmdResult<ElectronicInvoice> {
    let original = fetch_invoice(&state, invoice_id)?;
    if original.status != "autorizada" {
        return Err("Solo se puede anular una factura autorizada.".to_string());
    }
    if original.credited_invoice_id.is_some() {
        return Err("Esto ya es una nota de crédito, no se puede anular de nuevo.".to_string());
    }
    {
        let conn = state.db.lock();
        if let Some(rid) = return_id {
            let ya_tiene_nc: Option<i64> = conn.query_row(
                "SELECT id FROM electronic_invoices WHERE return_id=?1 AND status IN ('autorizada','pendiente') LIMIT 1",
                params![rid], |r| r.get(0),
            ).ok();
            if ya_tiene_nc.is_some() {
                return Err("Esta devolución ya tiene una nota de crédito emitida.".to_string());
            }
        } else if amount_cents.is_none() {
            let ya_anulada: Option<i64> = conn.query_row(
                "SELECT id FROM electronic_invoices WHERE credited_invoice_id=?1 AND status IN ('autorizada','pendiente') LIMIT 1",
                params![invoice_id], |r| r.get(0),
            ).ok();
            if ya_anulada.is_some() {
                return Err("Esta factura ya tiene una nota de crédito emitida.".to_string());
            }
        }

        // Defensa adicional (más allá de lo que ya garantiza returns.rs con la
        // cantidad vendida vs. devuelta): la suma de todas las notas de
        // crédito ya emitidas para esta factura, más la nueva, nunca puede
        // superar el total de la factura original.
        let already_credited: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_cents), 0) FROM electronic_invoices
             WHERE credited_invoice_id=?1 AND status IN ('autorizada','pendiente')",
            params![invoice_id], |r| r.get(0),
        ).unwrap_or(0);
        let this_amount = amount_cents.unwrap_or(original.total_cents);
        if already_credited + this_amount > original.total_cents {
            return Err(format!(
                "Esta nota de crédito ({}) sumada a las ya emitidas ({}) superaría el total de la factura original ({}).",
                this_amount, already_credited, original.total_cents
            ));
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

    // Antes de anular, se le pregunta a ARCA si la factura existe con ese
    // punto de venta y número, comparando el CAE. Caso real: una factura
    // rechazada con el punto de venta 2 se reintentó después de cambiar la
    // configuración al 3; ARCA la autorizó como 0003-00000001 pero la fila
    // quedó guardada con el 2. Sin este chequeo, la nota de crédito habría
    // apuntado a la 0002-00000001, que es otra factura (hecha por la página
    // de ARCA) y no tiene nada que ver con Mercalin.
    let original = match locate_original_in_arca(&state, &original, &cuit, punto_venta) {
        Ok(pv) if pv == original.punto_venta => original,
        Ok(pv) => {
            let conn = state.db.lock();
            conn.execute("UPDATE electronic_invoices SET punto_venta=?1 WHERE id=?2", params![pv, invoice_id]).map_err(err)?;
            drop(conn);
            fetch_invoice(&state, invoice_id)?
        }
        // Sin internet no se puede verificar: se sigue como siempre (la nota
        // queda pendiente) solo si no hay dudas sobre el punto de venta.
        Err(e) if is_connectivity_error(&e) && original.punto_venta == punto_venta => original,
        Err(e) if is_connectivity_error(&e) => {
            return Err("No hay conexión con ARCA para verificar esta factura antes de anularla. Probá de nuevo cuando tengas internet.".to_string());
        }
        Err(e) => return Err(e),
    };
    let cbte_asoc = (original.cbte_tipo, original.punto_venta, original.cbte_nro.unwrap_or(0));

    // Importe total de la NC: el completo de la factura salvo que se pida un
    // importe parcial (devolución de solo algunos ítems). El IVA se escala
    // en la misma proporción y el neto se saca por diferencia, para que
    // neto+iva dé exactamente el total (si no, ARCA rechaza el comprobante).
    let (total, neto, iva) = match amount_cents {
        Some(amt) if amt > 0 && amt < original.total_cents => {
            let iva_part = ((original.iva_cents as i128 * amt as i128) / original.total_cents.max(1) as i128) as i64;
            (amt, amt - iva_part, iva_part)
        }
        _ => (original.total_cents, original.neto_cents, original.iva_cents),
    };

    let concepto = if let Some(rid) = return_id {
        format!(
            "Devolución #{} — NC Factura {} {}-{}",
            rid, original.invoice_type,
            format!("{:04}", original.punto_venta),
            format!("{:08}", original.cbte_nro.unwrap_or(0)),
        )
    } else {
        format!(
            "Anula Factura {} {}-{}",
            original.invoice_type,
            format!("{:04}", original.punto_venta),
            format!("{:08}", original.cbte_nro.unwrap_or(0)),
        )
    };

    let input = InvoiceInput {
        sale_id: None,
        invoice_type: original.invoice_type.clone(),
        total_cents: total,
        neto_cents: neto,
        iva_cents: iva,
        client_cuit: original.client_cuit.clone(),
        client_name: original.client_name.clone(),
        doc_tipo: original.doc_tipo,
        doc_nro: original.client_cuit.clone().unwrap_or_else(|| "0".to_string()),
        concepto: Some(concepto),
        condicion_iva_receptor_id: original.condicion_iva_receptor_id,
    };

    let inv_id = {
        let conn = state.db.lock();
        conn.execute(
            "INSERT INTO electronic_invoices
             (sale_id, invoice_type, cbte_tipo, punto_venta, total_cents, neto_cents, iva_cents,
              client_cuit, client_name, doc_tipo, concepto, condicion_iva_receptor_id, credited_invoice_id, return_id, status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'pendiente')",
            params![
                Option::<i64>::None, input.invoice_type, nc_ct, punto_venta,
                input.total_cents, input.neto_cents, input.iva_cents,
                input.client_cuit, input.client_name, input.doc_tipo, input.concepto,
                input.condicion_iva_receptor_id, invoice_id, return_id,
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
                let status = if is_connectivity_error(e) { "pendiente" } else { "error" };
                conn.execute(
                    "UPDATE electronic_invoices SET status=?1, error_msg=?2 WHERE id=?3",
                    params![status, e, inv_id],
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
                total_cents, neto_cents, iva_cents, client_cuit, client_name, doc_tipo, status, error_msg, created_at, concepto, condicion_iva_receptor_id, credited_invoice_id, return_id
         FROM electronic_invoices ORDER BY created_at DESC LIMIT ?1"
    ).map_err(err)?;
    let x: Vec<ElectronicInvoice> = stmt.query_map(params![limit], row_to_invoice)
        .map_err(err)?.filter_map(|r| r.ok()).collect();
    Ok(x)
}

// Para Devoluciones: saber si la venta que se está por devolver tiene una
// factura ARCA vigente (no una NC), para poder ofrecer emitir la nota de
// crédito correspondiente al confirmar la devolución.
#[tauri::command]
pub fn get_invoice_for_sale(sale_id: i64, state: State<AppState>) -> CmdResult<Option<ElectronicInvoice>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, sale_id, invoice_type, cbte_tipo, punto_venta, cbte_nro, cae, cae_expires_at,
                total_cents, neto_cents, iva_cents, client_cuit, client_name, doc_tipo, status, error_msg, created_at, concepto, condicion_iva_receptor_id, credited_invoice_id, return_id
         FROM electronic_invoices WHERE sale_id=?1 AND credited_invoice_id IS NULL ORDER BY created_at DESC LIMIT 1"
    ).map_err(err)?;
    let result = stmt.query_row(params![sale_id], row_to_invoice);
    match result {
        Ok(inv) => Ok(Some(inv)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(err(e)),
    }
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
        if attempt_reissue(&state, inv_id, &cuit, punto_venta, &token, &sign, &environment).is_ok() {
            processed += 1;
        }
    }
    Ok(processed)
}

// Encontrado en la auditoría: no existía forma de reintentar UNA factura
// puntual -- solo el bulk de arriba (que además solo miraba 'pendiente', que
// nunca ocurría). Ahora permite reintentar una factura en 'error' o
// 'pendiente' desde Facturación, una por una.
#[tauri::command]
pub fn retry_invoice(invoice_id: i64, state: State<AppState>) -> CmdResult<ElectronicInvoice> {
    let inv = fetch_invoice(&state, invoice_id)?;
    if inv.status != "error" && inv.status != "pendiente" {
        return Err("Esta factura no está en un estado que se pueda reintentar.".to_string());
    }
    let (token, sign, environment) = get_or_refresh_token(&state)?;
    let (cuit, punto_venta) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT cuit, punto_venta FROM arca_config WHERE id=1",
            [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        ).map_err(err)?
    };
    let _ = attempt_reissue(&state, invoice_id, &cuit, punto_venta, &token, &sign, &environment);
    fetch_invoice(&state, invoice_id)
}

// Un solo intento de reemisión sobre una factura/NC ya insertada (en 'error'
// o 'pendiente'): pide el próximo número real a ARCA (nunca reutiliza uno ya
// autorizado) y reintenta el mismo pedido. Compartido por el reintento en
// lote y el individual para que ambos se comporten exactamente igual.
fn attempt_reissue(
    state: &AppState, inv_id: i64, cuit: &str, punto_venta: i64,
    token: &str, sign: &str, environment: &str,
) -> CmdResult<()> {
    let inv = fetch_invoice(state, inv_id)?;
    // El código ya guardado en `cbte_tipo` es el correcto tanto para
    // facturas (1/6/11) como para notas de crédito (3/8/13) -- no
    // recalcularlo con cbte_tipo(), que solo conoce las facturas.
    let ct = inv.cbte_tipo;
    let cbte_asoc = inv.credited_invoice_id.and_then(|orig_id| {
        fetch_invoice(state, orig_id).ok().map(|o| (o.cbte_tipo, o.punto_venta, o.cbte_nro.unwrap_or(0)))
    });
    let result: Result<(i64, String, String), String> = (|| {
        let last = get_last_cbte_nro(cuit, punto_venta, ct, token, sign, environment)?;
        let cbte_nro = last + 1;
        let input = InvoiceInput {
            sale_id: inv.sale_id, invoice_type: inv.invoice_type.clone(),
            total_cents: inv.total_cents, neto_cents: inv.neto_cents, iva_cents: inv.iva_cents,
            client_cuit: inv.client_cuit.clone(), client_name: inv.client_name.clone(),
            doc_tipo: inv.doc_tipo, doc_nro: inv.client_cuit.clone().unwrap_or_else(|| "0".to_string()),
            concepto: inv.concepto.clone(),
            condicion_iva_receptor_id: inv.condicion_iva_receptor_id,
        };
        let (cae, exp) = call_fecae_solicitar(cuit, punto_venta, ct, cbte_nro, &input, token, sign, environment, cbte_asoc)?;
        Ok((cbte_nro, cae, exp))
    })();
    let conn = state.db.lock();
    match result {
        Ok((cbte_nro, cae, exp)) => {
            // Se guarda también el punto de venta con el que ARCA la autorizó:
            // si la configuración cambió entre el primer intento y este, la
            // fila tenía el viejo y el comprobante se mostraba (y se anulaba)
            // con un número que no era el suyo.
            conn.execute(
                "UPDATE electronic_invoices SET cbte_nro=?1, cae=?2, cae_expires_at=?3, status='autorizada', punto_venta=?5, error_msg=NULL WHERE id=?4",
                params![cbte_nro, cae, exp, inv_id, punto_venta],
            ).map_err(err)?;
            Ok(())
        }
        Err(e) => {
            let status = if is_connectivity_error(&e) { "pendiente" } else { "error" };
            conn.execute(
                "UPDATE electronic_invoices SET status=?1, error_msg=?2 WHERE id=?3",
                params![status, e, inv_id],
            ).map_err(err)?;
            Err(e)
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn fetch_invoice(state: &AppState, id: i64) -> CmdResult<ElectronicInvoice> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, sale_id, invoice_type, cbte_tipo, punto_venta, cbte_nro, cae, cae_expires_at,
                total_cents, neto_cents, iva_cents, client_cuit, client_name, doc_tipo, status, error_msg, created_at, concepto, condicion_iva_receptor_id, credited_invoice_id, return_id
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
        credited_invoice_id: row.get(19)?, return_id: row.get(20)?,
    })
}

// Encontrado en la auditoría: "pendiente" era código muerto -- todo error acá
// (de red, de timeout, o un rechazo real y explícito de ARCA) terminaba
// guardado como 'error', así que retry_pending_invoices nunca encontraba
// nada para reintentar. Se distingue: un error de CONECTIVIDAD (no se sabe
// si ARCA llegó a procesar el pedido) queda 'pendiente' -- reintentar es
// seguro porque get_last_cbte_nro siempre pide el próximo número real a
// ARCA, nunca reutiliza uno ya autorizado. Un rechazo EXPLÍCITO de ARCA
// (SOAP fault, "ARCA rechazó...") queda 'error' -- reintentar la misma
// solicitud sin cambiar nada solo la va a rechazar de nuevo.
fn is_connectivity_error(msg: &str) -> bool {
    msg.starts_with("Error conectando con ARCA")
        || msg.starts_with("Error leyendo la respuesta")
}

// Motivo real de un rechazo de WSFE. La respuesta trae hasta tres listas de
// mensajes: <Observaciones> (del comprobante), <Events> (avisos generales que
// ARCA manda a todos, como el de la RG 5616) y <Errors>. Antes se mostraba el
// primer <Msg> que apareciera, que casi siempre es un aviso de <Events> -- la
// comerciante leía un texto que no tenía nada que ver con su problema.
fn arca_rejection_reason(xml: &str) -> String {
    let mut motivos: Vec<String> = Vec::new();
    for bloque in ["Errors", "Observaciones"] {
        let Some(contenido) = extract_xml_tag(xml, bloque) else { continue };
        let mut resto = contenido.as_str();
        while let Some(msg) = extract_xml_tag(resto, "Msg") {
            let hasta = resto.find("</Msg>").map(|i| i + "</Msg>".len()).unwrap_or(resto.len());
            let code = extract_xml_tag(&resto[..hasta], "Code");
            let texto = xml_unescape(&msg);
            motivos.push(match code {
                Some(c) => format!("{texto} (código {c})"),
                None => texto,
            });
            resto = &resto[hasta..];
        }
    }
    if motivos.is_empty() {
        return "ARCA no informó el motivo.".to_string();
    }
    let mut texto = motivos.join(" · ");
    let lower = texto.to_lowercase();
    if lower.contains("punto de venta") || lower.contains("ptovta") {
        texto.push_str(" — Revisá el punto de venta: para facturar desde Mercalin tiene que ser uno de tipo \"Web Services\", distinto del que usás en Comprobantes en línea.");
    }
    texto
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

    fn invoice_input(invoice_type: &str, doc_tipo: i64, doc_nro: &str) -> InvoiceInput {
        InvoiceInput {
            sale_id: None, invoice_type: invoice_type.to_string(),
            total_cents: 1000, neto_cents: 826, iva_cents: 174,
            client_cuit: None, client_name: None,
            doc_tipo, doc_nro: doc_nro.to_string(),
            concepto: None, condicion_iva_receptor_id: 5,
        }
    }

    #[test]
    fn rechaza_factura_a_sin_cuit_de_11_digitos() {
        // Este es el bug real: el tipo de documento se decidía en el frontend
        // solo por la longitud del texto -- una Factura A con un DNI (8
        // dígitos, doc_tipo 96) podía llegar a pedirse sin que nada la frene.
        assert!(validate_invoice_input(&invoice_input("A", 96, "12345678")).is_err());
        assert!(validate_invoice_input(&invoice_input("A", 80, "1234567890")).is_err()); // 10 dígitos, no 11
        assert!(validate_invoice_input(&invoice_input("A", 80, "20123456789")).is_ok());
    }

    #[test]
    fn factura_b_o_c_no_exige_cuit() {
        assert!(validate_invoice_input(&invoice_input("B", 99, "0")).is_ok());
        assert!(validate_invoice_input(&invoice_input("C", 96, "12345678")).is_ok());
    }

    #[test]
    fn clasifica_errores_de_conectividad_como_reintentables() {
        // Encontrado en la auditoría: "pendiente" era código muerto porque
        // todo error (de red o de rechazo real de ARCA) caía en "error".
        assert!(is_connectivity_error("Error conectando con ARCA: timeout"));
        assert!(is_connectivity_error("Error leyendo la respuesta de ARCA: conexión cerrada"));
        assert!(!is_connectivity_error("ARCA rechazó la factura: CUIT no autorizado"));
        assert!(!is_connectivity_error("No hay configuración ARCA"));
    }

    #[test]
    fn el_motivo_del_rechazo_sale_de_errors_y_no_del_aviso_general() {
        // Caso real: ARCA rechazó una Factura C y la app mostró el aviso de
        // la RG 5616 (que viene en <Events>) en lugar del motivo.
        let xml = "<FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp>\
            <Events><Evt><Code>39</Code><Msg>IMPORTANTE: El dia 6 de abril de 2025...</Msg></Evt></Events>\
            <Errors><Err><Code>10005</Code><Msg>El punto de venta no se encuentra habilitado</Msg></Err></Errors>\
            </FECAESolicitarResult>";
        let motivo = arca_rejection_reason(xml);
        assert!(motivo.starts_with("El punto de venta no se encuentra habilitado (código 10005)"));
        assert!(!motivo.contains("IMPORTANTE"));
        assert!(motivo.contains("Web Services"));
    }

    #[test]
    fn el_motivo_del_rechazo_junta_observaciones_y_errores() {
        let xml = "<FeDetResp><Observaciones><Obs><Code>10015</Code><Msg>DocNro inv&amp;aacute;lido</Msg></Obs>\
            <Obs><Code>10016</Code><Msg>Fecha fuera de rango</Msg></Obs></Observaciones></FeDetResp>\
            <Events><Evt><Code>39</Code><Msg>Aviso</Msg></Evt></Events>";
        let motivo = arca_rejection_reason(xml);
        assert!(motivo.contains("(código 10015)") && motivo.contains("Fecha fuera de rango (código 10016)"));
        assert!(!motivo.contains("Aviso"));
        assert_eq!(arca_rejection_reason("<Events><Evt><Msg>Aviso</Msg></Evt></Events>"), "ARCA no informó el motivo.");
    }

    #[test]
    fn clasifica_los_rechazos_de_wsaa() {
        // Texto real que devolvió ARCA con el certificado bien cargado pero
        // sin la relación de Facturación Electrónica.
        assert_eq!(classify_wsaa_error("Computador no autorizado a acceder al servicio"), "no_autorizado");
        assert_eq!(classify_wsaa_error("El CEE ya posee un TA valido para el acceso al WSN solicitado"), "ya_tiene_permiso");
        assert_eq!(classify_wsaa_error("Certificado expirado"), "certificado_vencido");
        assert_eq!(classify_wsaa_error("Certificado no emitido por AC de confianza"), "certificado_ajeno");
        assert_eq!(classify_wsaa_error("Firma inválida o algoritmo no soportado"), "certificado_no_coincide");
        assert_eq!(classify_wsaa_error("Error conectando con ARCA: timeout"), "sin_internet");
        assert_eq!(classify_wsaa_error("algo nuevo"), "otro");

        // El cartel que se ve al facturar ya trae qué hacer, y se sigue clasificando igual.
        let err = parse_wsaa_response("<faultstring>Computador no autorizado a acceder al servicio</faultstring>").unwrap_err();
        assert!(err.contains("Trámite A"));
        assert_eq!(evaluar_autorizacion(&Err(err)).codigo, "no_autorizado");
        assert_eq!(evaluar_autorizacion(&Ok(())).estado, "ok");
        assert_eq!(evaluar_autorizacion(&Err("Error conectando con ARCA: x".into())).estado, "duda");
    }

    #[test]
    fn lee_los_puntos_de_venta_que_sirven_para_web_services() {
        let xml = "<ResultGet>\
            <PtoVenta><Nro>3</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta>\
            <PtoVenta><Nro>5</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>S</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta>\
            <PtoVenta><Nro>4</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>20250101</FchBaja></PtoVenta>\
            <PtoVenta><Nro>1</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja></FchBaja></PtoVenta>\
            </ResultGet>";
        assert_eq!(parse_ptos_venta(xml), vec![1, 3]);
        assert!(parse_ptos_venta("<Errors><Err><Code>602</Code><Msg>Sin Resultados</Msg></Err></Errors>").is_empty());
    }

    #[test]
    fn veredicto_del_punto_de_venta() {
        // Caso real: configurado el 2 (Factura en Línea) y el único de Web Services es el 3.
        let v = evaluar_punto_venta(2, &Ok(vec![3]), &Ok(15));
        assert_eq!((v.estado.as_str(), v.codigo.as_str()), ("falta", "no_sirve"));
        assert!(v.detalle.contains("3"));

        assert_eq!(evaluar_punto_venta(3, &Ok(vec![3]), &Ok(1)).estado, "ok");
        // Sin ninguno de Web Services: hay que crearlo.
        let v = evaluar_punto_venta(2, &Ok(vec![]), &Err("ARCA rechazó la factura: no habilitado (código 11002)".into()));
        assert_eq!(v.codigo, "ninguno");
        assert!(v.detalle.contains("no habilitado") && !v.detalle.contains("rechazó la factura"));
        // La lista no vino pero la consulta respondió bien: no se afirma nada.
        assert_eq!(evaluar_punto_venta(3, &Ok(vec![]), &Ok(1)).estado, "duda");
        assert_eq!(evaluar_punto_venta(3, &Err("Error conectando con ARCA: x".into()), &Ok(1)).codigo, "sin_internet");
    }

    #[test]
    fn el_certificado_tiene_que_ser_de_la_clave_de_esta_compu() {
        let cert_de = |pkey: &PKey<openssl::pkey::Private>, dias: u32| {
            let mut name_builder = X509NameBuilder::new().unwrap();
            name_builder.append_entry_by_text("CN", "Test").unwrap();
            let name = name_builder.build();
            let mut b = X509Builder::new().unwrap();
            b.set_subject_name(&name).unwrap();
            b.set_issuer_name(&name).unwrap();
            b.set_pubkey(pkey).unwrap();
            b.set_not_before(&Asn1Time::days_from_now(0).unwrap()).unwrap();
            b.set_not_after(&Asn1Time::days_from_now(dias).unwrap()).unwrap();
            b.sign(pkey, MessageDigest::sha256()).unwrap();
            String::from_utf8(b.build().to_pem().unwrap()).unwrap()
        };
        let clave = PKey::from_rsa(Rsa::generate(2048).unwrap()).unwrap();
        let otra = PKey::from_rsa(Rsa::generate(2048).unwrap()).unwrap();
        let clave_pem = String::from_utf8(clave.private_key_to_pem_pkcs8().unwrap()).unwrap();

        assert!(cert_matches_key(&cert_de(&clave, 365), &clave_pem));
        // Caso real a evitar: se tocó "Generar de nuevo" después de pedir el certificado.
        assert!(!cert_matches_key(&cert_de(&otra, 365), &clave_pem));
        assert!(!cert_matches_key("no es un certificado", &clave_pem));
        assert!(!cert_expired(&cert_de(&clave, 365)));
    }

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
