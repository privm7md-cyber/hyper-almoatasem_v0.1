-- NULL identifies historical rows whose per-line reservation was not recorded.
ALTER TABLE order_items ADD COLUMN stock_reserved_quantity numeric(12, 3);

ALTER TABLE order_items ADD CONSTRAINT chk_order_items_stock_reservation
  CHECK (stock_reserved_quantity >= 0 AND stock_reserved_quantity <= requested_quantity);
