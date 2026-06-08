import { query } from "./db.js";

export async function backfillRosterDrugOfChoiceFromLatestIntake() {
  await query(
    `with latest_intake as (
       select distinct on (patient_id)
              patient_id,
              raw_json #> '{sections,intake,multi,substances}' as substances
         from public.intake_submissions
        where patient_id is not null
        order by patient_id, created_at desc
     ),
     source as (
       select patient_id,
              array(select jsonb_array_elements_text(substances)) as drug_of_choice
         from latest_intake
        where jsonb_typeof(substances) = 'array'
          and jsonb_array_length(substances) > 0
     )
     insert into public.patient_roster_details (patient_id, drug_of_choice, updated_by)
     select patient_id, drug_of_choice, null
       from source
     on conflict (patient_id) do update
       set drug_of_choice = excluded.drug_of_choice,
           updated_at = timezone('utc', now())
     where coalesce(cardinality(public.patient_roster_details.drug_of_choice), 0) = 0`
  );
}
