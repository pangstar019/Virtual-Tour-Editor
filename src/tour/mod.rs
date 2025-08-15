use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tour {
    id: i32,
    pub name: String,
    pub created_at: String,
    pub modified_at: String,
    pub initial_scene_id: i32,
    pub location: String,
    has_floorplan: bool,
    floorplan_id: Option<i32>
}

impl Tour {
    pub fn new(id: i32, name: String, created_at: String, modified_at: String, initial_scene_id: i32, location: String, has_floorplan: bool, floorplan_id: Option<i32>) -> Self {
        Tour {
            id,
            name,
            created_at,
            modified_at,
            initial_scene_id,
            location,
            has_floorplan,
            floorplan_id
        }
    }

    pub fn get_id(&self) -> i32 {
        self.id
    }

    pub fn set_id(&mut self, id: i32) {
        self.id = id;
    }
}