import { supabase } from "../config/supabase.js";

export async function writeAuditLog({
  action,
  actor_id,
  base_id = null,
  entity_type = null,
  entity_id = null,
  metadata = null,
}) {
  const { error } = await supabase.from("audit_logs").insert({
    action,
    actor_id,
    base_id,
    entity_type,
    entity_id,
    metadata,
  });

  // don't crash business flow if audit fails (but log it)
  if (error) console.error("audit log error:", error.message);
}
