use crate::app::state::AppDb;
use ielts_db::vocab::books;
use tauri::State;

#[tauri::command]
pub fn vocab_books(db: State<'_, AppDb>) -> Result<Vec<books::Book>, String> {
    db.with_conn(books::list_books).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vocab_book_units(db: State<'_, AppDb>, book_id: String) -> Result<Vec<books::Unit>, String> {
    db.with_conn(|conn| books::list_units(conn, &book_id)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vocab_book_words(
    db: State<'_, AppDb>, book_id: String, unit_id: Option<String>,
    limit: Option<u32>, offset: Option<u32>,
) -> Result<Vec<ielts_db::VocabularyItem>, String> {
    db.with_conn(|conn| books::list_words(conn, &book_id, unit_id.as_deref(),
        limit.unwrap_or(100), offset.unwrap_or(0))).map_err(|e| e.to_string())
}
