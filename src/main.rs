use axum::{
    extract::Json,
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::process::Command;
use tower_http::cors::CorsLayer;
use tracing::{info, warn};

#[derive(Debug, Deserialize)]
struct FormatRequest {
    code: String,
    language: String,
    formatter: Option<String>,
}

#[derive(Debug, Serialize)]
struct FormatResponse {
    formatted_code: String,
    execution_time_ms: u128,
    formatter_used: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
    details: String,
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "speed-formatter-mvp",
        "version": "0.1.0"
    }))
}

async fn format_code(Json(payload): Json<FormatRequest>) -> impl IntoResponse {
    let start_time = std::time::Instant::now();
    
    info!("Formatting {} code with {} characters", payload.language, payload.code.len());
    
    let result = match payload.language.as_str() {
        "javascript" | "typescript" | "js" | "ts" => {
            format_with_prettier(&payload.code).await
        },
        "rust" => {
            format_with_rustfmt(&payload.code).await
        },
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "Unsupported language".to_string(),
                    details: format!("Language '{}' is not supported yet", payload.language),
                })
            ).into_response();
        }
    };
    
    let execution_time = start_time.elapsed().as_millis();
    
    match result {
        Ok((formatted, formatter)) => {
            info!("Successfully formatted in {}ms using {}", execution_time, formatter);
            Json(FormatResponse {
                formatted_code: formatted,
                execution_time_ms: execution_time,
                formatter_used: formatter,
                status: "success".to_string(),
            }).into_response()
        },
        Err(error) => {
            warn!("Formatting failed: {}", error);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Formatting failed".to_string(),
                    details: error,
                })
            ).into_response()
        }
    }
}

async fn format_with_prettier(code: &str) -> Result<(String, String), String> {
    // First try to use Prettier if available
    let mut cmd = Command::new("npx");
    cmd.args(&["prettier", "--stdin-filepath", "file.js", "--parser", "babel"]);
    
    let output = cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn prettier: {}", e))?;
    
    let stdin = output.stdin.as_ref().ok_or("Failed to open stdin")?;
    std::io::Write::write_all(&mut std::io::BufWriter::new(stdin), code.as_bytes())
        .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    
    let result = output.wait_with_output().map_err(|e| format!("Prettier failed: {}", e))?;
    
    if result.status.success() {
        let formatted = String::from_utf8_lossy(&result.stdout).to_string();
        Ok((formatted, "prettier".to_string()))
    } else {
        let error = String::from_utf8_lossy(&result.stderr);
        Err(format!("Prettier error: {}", error))
    }
}

async fn format_with_rustfmt(code: &str) -> Result<(String, String), String> {
    let mut cmd = Command::new("rustfmt");
    cmd.arg("--emit").arg("stdout");
    
    let output = cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn rustfmt: {}", e))?;
    
    let stdin = output.stdin.as_ref().ok_or("Failed to open stdin")?;
    std::io::Write::write_all(&mut std::io::BufWriter::new(stdin), code.as_bytes())
        .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    
    let result = output.wait_with_output().map_err(|e| format!("rustfmt failed: {}", e))?;
    
    if result.status.success() {
        let formatted = String::from_utf8_lossy(&result.stdout).to_string();
        Ok((formatted, "rustfmt".to_string()))
    } else {
        let error = String::from_utf8_lossy(&result.stderr);
        Err(format!("rustfmt error: {}", error))
    }
}

async fn serve_ui() -> Html<&'static str> {
    Html(include_str!("../static/index.html"))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::init();
    
    let app = Router::new()
        .route("/", get(serve_ui))
        .route("/health", get(health))
        .route("/format", post(format_code))
        .layer(CorsLayer::permissive());
    
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");
        
    info!("🚀 Speed Formatter MVP running on http://0.0.0.0:3000");
    info!("📊 Health check: http://localhost:3000/health");
    info!("🎨 Format API: POST http://localhost:3000/format");
    
    axum::serve(listener, app)
        .await
        .expect("Server failed to start");
}