use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub app: AppConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AppConfig {
    pub name: String,
    pub version: String,
}

impl Config {
    /// Load configuration from a TOML file
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error>> {
        let config_str = fs::read_to_string(path)?;
        let config: Config = toml::from_str(&config_str)?;
        Ok(config)
    }

    /// Determine the canonical system configuration path.
    /// Windows: %APPDATA%/VirtualTourEditor/config.toml
    /// macOS: ~/Library/Application Support/VirtualTourEditor/config.toml
    /// Linux/Unix: $XDG_CONFIG_HOME/virtual-tour-editor/config.toml or ~/.config/virtual-tour-editor/config.toml
    pub fn system_config_path() -> std::path::PathBuf {
        #[cfg(target_os = "windows")]
        {
            if let Some(appdata) = std::env::var_os("APPDATA") {
                return std::path::PathBuf::from(appdata).join("VirtualTourEditor").join("config.toml");
            }
            // Fallback to current dir if APPDATA missing
            return std::path::PathBuf::from("config.toml");
        }
    }

    /// Load configuration solely from the system configuration path.
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::system_config_path();
        if !path.exists() {
            return Err(From::from(format!("config file not found at system path: {:?}", path)));
        }
        println!("Config loading from system path: {:?}", path);
        Self::load_from_file(path)
    }

    /// Get the server bind address
    pub fn server_address(&self) -> String {
        format!("{}:{}", self.server.host, self.server.port)
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                host: "0.0.0.0".to_string(),
                port: 1112,
            },
            database: DatabaseConfig {
                url: "sqlite:./virtual_tour_editor.db".to_string(),
            },
            app: AppConfig {
                name: "Virtual Tour Editor".to_string(),
                version: "2.1.0".to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.server.host, "0.0.0.0");
        assert_eq!(config.server.port, 1112);
        assert_eq!(config.app.name, "Virtual Tour Editor");
    }

    #[test]
    fn test_server_address() {
        let config = Config::default();
        assert_eq!(config.server_address(), "0.0.0.0:1112");
    }
}
