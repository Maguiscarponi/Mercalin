// Guardado de la clave privada de ARCA.
//
// En la app de escritorio la base vive en la compu del comercio, así que la
// clave se guarda como siempre (texto PEM). En la versión web todas las bases
// viven en el servidor: ahí la clave se guarda encriptada (AES-256-GCM) con
// una clave del servidor que NO está en ninguna base. Si alguien llegara a
// copiar la base de un comercio, no podría facturar en su nombre.
//
// `open` acepta las dos formas, así que una base con la clave en texto (por
// ejemplo, un backup que vino de la app de escritorio) sigue funcionando.

#[cfg(feature = "server")]
use std::sync::OnceLock;

#[cfg(feature = "server")]
static KEY: OnceLock<[u8; 32]> = OnceLock::new();

const PREFIX: &str = "enc1:";

/// Lo llama el servidor web al arrancar. Sin esto, se guarda en texto.
#[cfg(feature = "server")]
pub fn set_key(key: [u8; 32]) {
    let _ = KEY.set(key);
}

pub fn seal(plain: &str) -> String {
    #[cfg(feature = "server")]
    if let Some(key) = KEY.get() {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};
        use base64::Engine;
        use rand::RngCore;
        let cipher = Aes256Gcm::new_from_slice(key).expect("clave de 32 bytes");
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        if let Ok(ct) = cipher.encrypt(Nonce::from_slice(&nonce), plain.as_bytes()) {
            let mut out = nonce.to_vec();
            out.extend_from_slice(&ct);
            return format!("{}{}", PREFIX, base64::engine::general_purpose::STANDARD.encode(out));
        }
    }
    plain.to_string()
}

pub fn open(stored: &str) -> Result<String, String> {
    let Some(rest) = stored.strip_prefix(PREFIX) else {
        return Ok(stored.to_string());
    };
    #[cfg(feature = "server")]
    {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};
        use base64::Engine;
        let key = KEY.get().ok_or("Falta la clave del servidor para leer la clave de ARCA.")?;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(rest)
            .map_err(|_| "La clave de ARCA guardada está dañada.".to_string())?;
        if raw.len() < 13 {
            return Err("La clave de ARCA guardada está dañada.".into());
        }
        let cipher = Aes256Gcm::new_from_slice(key).expect("clave de 32 bytes");
        let plain = cipher
            .decrypt(Nonce::from_slice(&raw[..12]), &raw[12..])
            .map_err(|_| "No se pudo leer la clave de ARCA (la clave del servidor no coincide).".to_string())?;
        return String::from_utf8(plain).map_err(|_| "La clave de ARCA guardada está dañada.".into());
    }
    #[cfg(not(feature = "server"))]
    {
        let _ = rest;
        Err("Esta clave de ARCA fue guardada por la versión web y no se puede usar acá. Generá una nueva en Facturación.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texto_sin_encriptar_se_lee_igual() {
        assert_eq!(open("-----BEGIN PRIVATE KEY-----").unwrap(), "-----BEGIN PRIVATE KEY-----");
    }

    #[cfg(feature = "server")]
    #[test]
    fn encripta_y_desencripta() {
        set_key([7u8; 32]);
        let sealed = seal("clave secreta");
        assert!(sealed.starts_with(PREFIX));
        assert!(!sealed.contains("clave secreta"));
        assert_eq!(open(&sealed).unwrap(), "clave secreta");
    }
}
