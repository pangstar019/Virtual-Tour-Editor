# Configuration Guide

This project uses a TOML-based configuration system. The configuration file is located at `config.toml` in the project root.

## Configuration Structure

### Server Settings
```toml
[server]
host = "0.0.0.0"      # Server bind address
port = 1112           # Server port
```

### Database Configuration
```toml
[database]
url = "sqlite:./virtual_tour_editor.db"  # Database connection string
```

### Application Settings
```toml
[app]
name = "Virtual Tour Editor"
version = "0.2.0"
```

## Environment Variables

You can also override configuration values using environment variables:
- `VTE_SERVER_HOST` - Override server host
- `VTE_SERVER_PORT` - Override server port

## Configuration Loading

The application loads configuration in the following order:
1. Default values
2. `config.toml` file
3. Environment variables (if implemented)

If the config file is missing or contains errors, the application will use default values and display a warning.

## Usage in Code

```rust
use crate::config::Config;

// Load configuration
let config = Config::load().unwrap_or_default();

// Access configuration values
println!("Server: {}", config.server_address());
```

## Security Notes

- Never commit your `config.toml` with real OAuth credentials to version control
- Consider using environment variables for production deployments
- The client secret should be kept secure and never exposed to client-side code
