-- Local (domestic Argentina) delivery cost on a shipment.
--
-- Stored as all three of: the pesos actually billed, the USD/ARS rate used to
-- convert them, and the resulting USD. Keeping the rate frozen alongside the
-- amount is what makes a costed shipment reproducible — re-costing months later
-- at a different rate must not move landed costs that are already booked.
ALTER TABLE "shipments" ADD COLUMN     "localShippingArs" DOUBLE PRECISION,
ADD COLUMN     "localShippingRate" DOUBLE PRECISION,
ADD COLUMN     "localShippingUsd" DOUBLE PRECISION;
