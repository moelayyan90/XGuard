use serde::{Deserialize, Serialize};
use std::{env, fs, path::Path};
use xguard_core::{Decision, PolicyConfig, TransactionView, classify};

#[derive(Debug, Deserialize)]
struct Fixture {
    name: String,
    transaction: TransactionView,
}

#[derive(Debug, Serialize)]
struct ResultRow {
    name: String,
    decision: Decision,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        return Err(format!(
            "usage: {} <rules.json> <transactions.json>",
            args.first().map(String::as_str).unwrap_or("xguard-sim")
        ));
    }

    let config: PolicyConfig = read_json(Path::new(&args[1]))?;
    config.validate().map_err(|e| e.to_string())?;
    let fixtures: Vec<Fixture> = read_json(Path::new(&args[2]))?;

    let rows: Vec<ResultRow> = fixtures
        .into_iter()
        .map(|fixture| ResultRow {
            name: fixture.name,
            decision: classify(&config, &fixture.transaction),
        })
        .collect();

    let output = serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?;
    println!("{output}");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("xguard-sim: {error}");
        std::process::exit(2);
    }
}
