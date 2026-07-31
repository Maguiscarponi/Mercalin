use crate::commands::{err, CmdResult};
use crate::models::{ArcaConfig, ArcaConfigInput, ElectronicInvoice, InvoiceInput};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
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

// ─── Configuración ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_arca_config(state: State<AppState>) -> CmdResult<Option<ArcaConfig>> {
    let conn = state.db.lock();
    let row = conn.query_row(
        "SELECT cuit, razon_social, punto_venta, private_key_pem, certificate_pem, environment, token, token_expires_at
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
        )),
    );
    match row {
        Err(_) => Ok(None),
        Ok((cuit, razon_social, punto_venta, private_key, certificate, environment, token, token_expires_at)) => {
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
            }))
        }
    }
}

#[tauri::command]
pub fn save_arca_config(input: ArcaConfigInput, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO arca_config (id, cuit, razon_social, punto_venta, environment, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           cuit=excluded.cuit, razon_social=excluded.razon_social,
           punto_venta=excluded.punto_venta, environment=excluded.environment,
           updated_at=CURRENT_TIMESTAMP",
        params![input.cuit, input.razon_social, input.punto_venta, input.environment],
    ).map_err(err)?;
    Ok(())
}

// ─── Certificado digital ──────────────────────────────────────────────────────

#[tauri::command]
pub fn generate_arca_keypair(_state: State<AppState>) -> CmdResult<String> {
    // STUB: requiere OpenSSL (Strawberry Perl). Habilitá el crate openssl en Cargo.toml
    // y reemplazá esta función con la implementación completa cuando esté disponible.
    Err("Para generar el certificado necesitás instalar Strawberry Perl y recompilar con OpenSSL. \
         Ver instrucciones en el chat.".to_string())
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

fn sign_tra(_tra: &str, _cert_pem: &str, _private_key_pem: &str) -> Result<String, String> {
    // STUB: firma PKCS#7 requiere OpenSSL con Strawberry Perl
    Err("La firma PKCS#7 requiere OpenSSL. Instalá Strawberry Perl y recompilá.".to_string())
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
    let response = ureq::post(wsaa_url(env))
        .set("Content-Type", "text/xml; charset=UTF-8")
        .set("SOAPAction", "loginCms")
        .timeout(std::time::Duration::from_secs(30))
        .send_string(&body)
        .map_err(|e| format!("Error conectando con ARCA WSAA: {}", e))?;
    let xml = response.into_string().map_err(err)?;
    parse_wsaa_response(&xml)
}

fn parse_wsaa_response(xml: &str) -> Result<(String, String, String), String> {
    let token = extract_xml_tag(xml, "token")
        .ok_or("ARCA WSAA: no se encontró el token")?;
    let sign = extract_xml_tag(xml, "sign")
        .ok_or("ARCA WSAA: no se encontró el sign")?;
    let expiration = extract_xml_tag(xml, "expirationTime")
        .ok_or("ARCA WSAA: no se encontró expirationTime")?;
    Ok((token, sign, expiration))
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

    // Renovar
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
      <ar:Auth><Token>{}</Token><Sign>{}</Sign><Cuit>{}</Cuit></ar:Auth>
      <ar:PtoVta>{}</ar:PtoVta>
      <ar:CbteTipo>{}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>"#,
        token, sign, cuit, pv, ct
    );
    let response = ureq::post(wsfev1_url(env))
        .set("Content-Type", "text/xml; charset=UTF-8")
        .set("SOAPAction", "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado")
        .timeout(std::time::Duration::from_secs(30))
        .send_string(&body)
        .map_err(|e| format!("Error consultando último comprobante: {}", e))?;
    let xml = response.into_string().map_err(err)?;
    Ok(extract_xml_tag(&xml, "CbteNro").and_then(|s| s.parse().ok()).unwrap_or(0))
}

fn call_fecae_solicitar(
    cuit: &str, pv: i64, ct: i64, nro: i64,
    input: &InvoiceInput, token: &str, sign: &str, env: &str,
) -> Result<(String, String), String> {
    let fecha = chrono::Local::now().format("%Y%m%d").to_string();
    let total = format!("{:.2}", input.total_cents as f64 / 100.0);
    let neto  = format!("{:.2}", input.neto_cents as f64 / 100.0);
    let iva   = format!("{:.2}", input.iva_cents as f64 / 100.0);
    let doc_nro = if input.doc_tipo == 99 { "0".to_string() } else { input.doc_nro.clone() };
    let iva_block = if ct == 1 || ct == 6 {
        format!("<Iva><AlicIva><Id>5</Id><BaseImp>{}</BaseImp><Importe>{}</Importe></AlicIva></Iva>", neto, iva)
    } else { String::new() };

    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth><Token>{token}</Token><Sign>{sign}</Sign><Cuit>{cuit}</Cuit></ar:Auth>
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
    );

    let response = ureq::post(wsfev1_url(env))
        .set("Content-Type", "text/xml; charset=UTF-8")
        .set("SOAPAction", "http://ar.gov.afip.dif.FEV1/FECAESolicitar")
        .timeout(std::time::Duration::from_secs(30))
        .send_string(&body)
        .map_err(|e| format!("Error solicitando CAE: {}", e))?;

    let xml = response.into_string().map_err(err)?;
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
              client_cuit, client_name, doc_tipo, status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'pendiente')",
            params![
                input.sale_id, input.invoice_type, ct, punto_venta,
                input.total_cents, input.neto_cents, input.iva_cents,
                input.client_cuit, input.client_name, input.doc_tipo,
            ],
        ).map_err(err)?;
        conn.last_insert_rowid()
    };

    let result: Result<(i64, String, String), String> = (|| {
        let (token, sign, env) = get_or_refresh_token(&state)?;
        let last = get_last_cbte_nro(&cuit, punto_venta, ct, &token, &sign, &env)?;
        let cbte_nro = last + 1;
        let (cae, exp) = call_fecae_solicitar(&cuit, punto_venta, ct, cbte_nro, &input, &token, &sign, &env)?;
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
                total_cents, neto_cents, iva_cents, client_cuit, client_name, doc_tipo, status, error_msg, created_at
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
        let ct = cbte_tipo(&inv.invoice_type);
        let result: Result<(i64, String, String), String> = (|| {
            let last = get_last_cbte_nro(&cuit, punto_venta, ct, &token, &sign, &environment)?;
            let cbte_nro = last + 1;
            let input = InvoiceInput {
                sale_id: inv.sale_id, invoice_type: inv.invoice_type.clone(),
                total_cents: inv.total_cents, neto_cents: inv.neto_cents, iva_cents: inv.iva_cents,
                client_cuit: inv.client_cuit.clone(), client_name: inv.client_name.clone(),
                doc_tipo: inv.doc_tipo, doc_nro: inv.client_cuit.clone().unwrap_or_else(|| "0".to_string()),
            };
            let (cae, exp) = call_fecae_solicitar(&cuit, punto_venta, ct, cbte_nro, &input, &token, &sign, &environment)?;
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
                total_cents, neto_cents, iva_cents, client_cuit, client_name, doc_tipo, status, error_msg, created_at
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
    })
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].trim().to_string())
}
