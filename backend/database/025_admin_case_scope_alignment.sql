-- ABAC alignment for case queues: unassigned cases are visible to the
-- triage roles so they can claim them; assigned cases remain staff-scoped.
DROP POLICY IF EXISTS kyc_case_scope ON kyc_applications;
CREATE POLICY kyc_case_scope ON kyc_applications
  USING (
    assigned_staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
    OR (assigned_staff_id IS NULL AND current_setting('app.staff_scope', true) IN ('SUPPORT', 'OPERATIONS'))
  );

DROP POLICY IF EXISTS credit_case_scope ON credit_applications;
CREATE POLICY credit_case_scope ON credit_applications
  USING (
    assigned_staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
    OR (assigned_staff_id IS NULL AND current_setting('app.staff_scope', true) IN ('SUPPORT', 'OPERATIONS'))
  );

DROP POLICY IF EXISTS case_assignment_scope ON case_assignments;
CREATE POLICY case_assignment_scope ON case_assignments
  USING (
    staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
  );

DROP POLICY IF EXISTS case_note_scope ON case_internal_notes;
CREATE POLICY case_note_scope ON case_internal_notes
  USING (
    author_staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
    OR current_setting('app.staff_scope', true) IN ('CONTROL', 'ADMIN')
    OR EXISTS (
      SELECT 1 FROM case_assignments assignment
      WHERE assignment.case_type = case_internal_notes.case_type
        AND assignment.case_id = case_internal_notes.case_id
        AND assignment.staff_id::text = NULLIF(current_setting('app.staff_id', true), '')
        AND assignment.status = 'ACTIVE'
    )
  );

COMMENT ON POLICY kyc_case_scope ON kyc_applications IS 'ABAC: assigned staff, control/admin, or unassigned triage queue';
COMMENT ON POLICY credit_case_scope ON credit_applications IS 'ABAC: assigned staff, control/admin, or unassigned triage queue';
