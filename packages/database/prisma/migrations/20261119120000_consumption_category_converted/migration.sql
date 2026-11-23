-- Units taken out of a quantity-tracked pool and made into individually
-- tracked assets ("Create assets from stock"). The pool's total goes down
-- like a loss, but the units are still in the workspace, now as assets.
ALTER TYPE "ConsumptionCategory" ADD VALUE IF NOT EXISTS 'CONVERTED';
