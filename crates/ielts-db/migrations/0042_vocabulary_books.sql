-- Provider identities and membership are independent of a learner's word and SM-2 state.
CREATE TABLE vocabulary_books (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    owner_key TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, owner_key, source_id)
);
CREATE TABLE vocabulary_book_units (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT NOT NULL REFERENCES vocabulary_books(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position >= 0),
    UNIQUE(book_id, source_id)
);
CREATE TABLE vocabulary_book_entries (
    unit_id TEXT NOT NULL REFERENCES vocabulary_book_units(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    PRIMARY KEY(unit_id, source_id)
);
CREATE INDEX vocabulary_book_units_order ON vocabulary_book_units(book_id, position, id);
CREATE INDEX vocabulary_book_entries_item ON vocabulary_book_entries(item_id);
CREATE INDEX vocabulary_book_entries_order ON vocabulary_book_entries(unit_id, position, source_id);
