//! Where the AI API key lives (ADR-0003 principle 7): the OS credential store (Windows
//! Credential Manager, macOS Keychain, the kernel keyring on Linux), never `settings.json`,
//! the log or the feedback excerpt. Test mode keeps it in memory for the process so E2E runs
//! never touch the user's real store.

use std::sync::Mutex;

const SERVICE: &str = "de.devsym.meshkeep";
const USER: &str = "ai-api-key";

pub enum AiKeyStore {
    Keyring,
    Memory(Mutex<Option<String>>),
}

impl AiKeyStore {
    pub fn new(test_mode: bool) -> AiKeyStore {
        if test_mode {
            AiKeyStore::Memory(Mutex::new(None))
        } else {
            AiKeyStore::Keyring
        }
    }

    pub fn get(&self) -> Result<Option<String>, String> {
        match self {
            AiKeyStore::Memory(m) => Ok(m.lock().unwrap().clone()),
            AiKeyStore::Keyring => match keyring::Entry::new(SERVICE, USER).map_err(|e| e.to_string())?.get_password() {
                Ok(k) => Ok(Some(k).filter(|k| !k.trim().is_empty())),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.to_string()),
            },
        }
    }

    /// `None` or an empty string removes the key.
    pub fn set(&self, key: Option<&str>) -> Result<(), String> {
        let key = key.map(str::trim).filter(|k| !k.is_empty());
        match self {
            AiKeyStore::Memory(m) => {
                *m.lock().unwrap() = key.map(str::to_string);
                Ok(())
            }
            AiKeyStore::Keyring => {
                let entry = keyring::Entry::new(SERVICE, USER).map_err(|e| e.to_string())?;
                match key {
                    Some(k) => entry.set_password(k).map_err(|e| e.to_string()),
                    None => match entry.delete_credential() {
                        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                        Err(e) => Err(e.to_string()),
                    },
                }
            }
        }
    }
}
