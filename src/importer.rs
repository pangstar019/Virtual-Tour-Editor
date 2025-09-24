//! Importer module
//!
//! Reconstructs a tour (tours, assets, connections) from an exported
//! tourData.js plus an assets directory.
//!
//! Expected tourData.js format (from export):
//! const tourData = { id, name, created_at, modified_at, initial_scene_id,
//!   has_floorplan, floorplan_id, floorplan: { id, file_path, name, ... } | null,
//!   floorplan_markers: [ { id, scene_id, position:[x,y] }, ...],
//!   scenes: [ { id, name, file_path, initial_view_x, initial_view_y, north_dir, initial_fov,
//!              connections: [ { id, target_scene_id, position:[x,y], name, file_path, connection_type, icon_index } ] } ] };
//!
//! Note: Export loses original DB IDs context when re-importing; we assign new IDs.
//! Scenes are matched by name for connections mapping during this import process.

use crate::database::Database;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::fs;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
struct RawTourData {
    id: Option<i64>,
    name: String,
    created_at: Option<String>,
    modified_at: Option<String>,
    initial_scene_id: Option<i64>,
    has_floorplan: Option<bool>,
    floorplan_id: Option<i64>,
    floorplan: Option<RawAsset>,
    floorplan_markers: Option<Vec<RawFloorplanMarker>>,    
    scenes: Vec<RawScene>,
}

#[derive(Debug, Deserialize, Clone)]
struct RawAsset {
    id: Option<i64>,
    file_path: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawFloorplanMarker {
    id: Option<i64>,
    scene_id: i64,
    position: [f32; 2],
}

#[derive(Debug, Deserialize, Clone)]
struct RawConnection {
    id: Option<i64>,
    target_scene_id: Option<i64>,
    position: [f32; 2],
    name: Option<String>,
    file_path: Option<String>,
    connection_type: Option<String>, // "Transition" | "Closeup"
    icon_index: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
struct RawScene {
    id: Option<i64>,
    name: String,
    file_path: Option<String>,
    created_at: Option<String>,
    modified_at: Option<String>,
    initial_view_x: Option<f32>,
    initial_view_y: Option<f32>,
    north_dir: Option<f32>,
    initial_fov: Option<f32>,
    connections: Vec<RawConnection>,
}

#[derive(Debug)]
pub struct ImportResult {
    pub tour_id: i64,
    pub scene_count: usize,
    pub connection_count: usize,
    pub closeup_count: usize,
    pub floorplan_id: Option<i64>,
}

/// Parse the tourData.js file and strip the leading assignment.
fn parse_tourdata_js(contents: &str) -> Result<RawTourData, String> {
    // Expect beginning like: const tourData = { ... };
    let start = contents.find('{').ok_or("No opening brace found in tourData.js")?;
    // naive trim to last '};'
    let end = contents.rfind('}').ok_or("No closing brace found")?;
    let json_slice = &contents[start..=end];
    serde_json::from_str::<RawTourData>(json_slice).map_err(|e| format!("Failed to parse JSON: {e}"))
}

/// Imports a tour from an exported folder.
///
/// Parameters:
/// * `db` - database handle
/// * `owner` - username that will own the imported tour (user must exist)
/// * `export_dir` - directory containing tourData.js and assets/ subdirectory
/// * `copy_assets_to` - root under which to copy assets (e.g. "assets")
///   The original export keeps relative paths like assets/insta360/... ; we preserve structure.
///
/// Returns `ImportResult` on success.
pub async fn import_tour_from_export(db: Arc<Database>, owner: &str, export_dir: impl AsRef<Path>, copy_assets_to: impl AsRef<Path>) -> Result<ImportResult, Box<dyn std::error::Error>> {
    let export_dir = export_dir.as_ref();
    // Support sample export structure: <export>/js/tourData.js or directly under export root
    let tourdata_path_root = export_dir.join("tourData.js");
    let tourdata_path_js = export_dir.join("js").join("tourData.js");
    let tourdata_path = if tourdata_path_js.exists() { tourdata_path_js } else { tourdata_path_root };
    if !tourdata_path.exists() { return Err(format!("tourData.js not found (looked in root and js/)").into()); }
    let contents = fs::read_to_string(&tourdata_path)?;
    let raw = parse_tourdata_js(&contents).map_err(|e| format!("parse error: {e}"))?;

    // Create new tour (ignore original id / timestamps)
    let new_tour_id = db.create_tour(owner, &raw.name, "").await?;

    // Map of old scene id -> new scene asset id
    use std::collections::HashMap;
    let mut scene_id_map: HashMap<i64, i64> = HashMap::new();
    let mut name_to_new_scene: HashMap<String, i64> = HashMap::new();

    // Copy & insert scenes
    for scene in &raw.scenes {
        // Determine file path; maintain relative path inside assets folder
        if let Some(fp) = &scene.file_path {
            copy_asset_if_exists(export_dir, fp, copy_assets_to.as_ref())?;
        }
        let new_scene_id = db.save_scene(new_tour_id, &scene.name, scene.file_path.as_deref().unwrap_or(""), scene.initial_view_x, scene.initial_view_y, scene.north_dir).await?;
        if let Some(old_id) = scene.id { scene_id_map.insert(old_id, new_scene_id); }
        name_to_new_scene.insert(scene.name.clone(), new_scene_id);
    }

    // Floorplan (if any)
    let mut new_floorplan_id: Option<i64> = None;
    if raw.has_floorplan.unwrap_or(false) {
        if let Some(fp) = raw.floorplan.as_ref() {
            if let Some(path) = &fp.file_path { copy_asset_if_exists(export_dir, path, copy_assets_to.as_ref())?; }
            let fname = fp.name.clone().unwrap_or_else(|| "Floorplan".to_string());
            let id = db.save_floorplan(new_tour_id, &fname, fp.file_path.as_deref().unwrap_or("")).await?;
            new_floorplan_id = Some(id);
        }
    }

    // Insert connections (scene transitions & closeups)
    let mut connection_count = 0usize;
    let mut closeup_count = 0usize;
    for scene in &raw.scenes {
        // Lookup new start scene id
        let start_new_id = scene_id_map.get(&scene.id.unwrap_or(-1)).copied().unwrap_or_else(|| *name_to_new_scene.get(&scene.name).expect("scene name present"));
        for conn in &scene.connections {
            if let Some(fp) = &conn.file_path { copy_asset_if_exists(export_dir, fp, copy_assets_to.as_ref())?; }
            let is_transition = matches!(conn.connection_type.as_deref(), Some("Transition"));
            let end_id = conn.target_scene_id.and_then(|old| scene_id_map.get(&old).copied());
            let icon_type = conn.icon_index.map(|v| v as i32);
            db.save_connection(new_tour_id, start_new_id, end_id, conn.position[0], conn.position[1], is_transition, conn.name.as_deref(), conn.file_path.as_deref(), icon_type).await?;
            connection_count += 1;
            if !is_transition { closeup_count += 1; }
        }
    }

    // Floorplan markers
    if let (Some(fpid), Some(markers)) = (new_floorplan_id, raw.floorplan_markers.as_ref()) {
        for m in markers {
            // Map original scene id to new id
            if let Some(scene_new_id) = scene_id_map.get(&m.scene_id) {
                db.save_floorplan_marker(new_tour_id, fpid, *scene_new_id, m.position[0], m.position[1]).await?;
            }
        }
    }

    // Set initial scene if we can map it
    if let Some(old_initial) = raw.initial_scene_id { if let Some(mapped) = scene_id_map.get(&old_initial) { let _ = db.set_initial_scene(new_tour_id, *mapped).await; } }

    Ok(ImportResult { tour_id: new_tour_id, scene_count: raw.scenes.len(), connection_count, closeup_count, floorplan_id: new_floorplan_id })
}

fn copy_asset_if_exists(export_root: &Path, relative_path: &str, dest_assets_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Paths in export likely like "assets/insta360/XYZ.jpg"; we preserve after dest root.
    let rel = relative_path.trim_start_matches('/');
    let source = export_root.join(rel);
    if source.exists() {
        let dest = dest_assets_root.join(rel);
        if let Some(parent) = dest.parent() { fs::create_dir_all(parent)?; }
        // Only copy if not already present (avoid overwriting newer local edits)
        if !dest.exists() {
            fs::copy(&source, &dest)?;
            println!("Imported asset file {:?} -> {:?}", source, dest);
        }
    } else {
        eprintln!("Warning: asset referenced but missing in export: {}", relative_path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> Database {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let schema_sql = include_str!("./schema.sql");
        sqlx::raw_sql(schema_sql).execute(&pool).await.unwrap();
        Database::new(pool)
    }

    #[tokio::test]
    async fn test_parse_tourdata_js() {
        let sample = "const tourData = { \"name\": \"Sample\", \"scenes\": [], \"floorplan_markers\": [] };";
        let parsed = parse_tourdata_js(sample).unwrap();
        assert_eq!(parsed.name, "Sample");
    }
}
