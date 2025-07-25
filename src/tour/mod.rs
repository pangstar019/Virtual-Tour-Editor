



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
}