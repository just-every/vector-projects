import { useRef, useState } from "react";
import { z } from "zod";
import { fetchJson } from "../../app/api-client";
import type { Administration } from "../administration/schema";
import { useAdministrationCall } from "../settings/ui/admin/administration";
import { NumberField } from "../settings/ui/fields/number-field";
import { useSerialSaves } from "../settings/ui/fields/serial-saves";
import { SwitchField } from "../settings/ui/fields/switch-field";
import { flushUnsaved } from "../settings/ui/fields/unsaved";
import { housekeepingPreviewSchema, type Housekeeping } from "./schema";
import "./housekeeping.css";

type Preview = z.infer<typeof housekeepingPreviewSchema>;
const unset: Housekeeping = { closeAfterDays: null, archiveAfterDays: null, exemptBugs: true };
const ruleOf = (data: Administration, teamId: string): Housekeeping => {
  const rule = data.housekeeping.find((item) => item.teamId === teamId);
  return rule ? { closeAfterDays: rule.closeAfterDays, archiveAfterDays: rule.archiveAfterDays, exemptBugs: rule.exemptBugs } : unset;
};

/** A team's auto-close and auto-archive: each choice is stored as it changes, and Preview shows what the next run would do. */
export function TeamHousekeeping({ data, team }: { data: Administration; team: Administration["teams"][number] }) {
  const call = useAdministrationCall();
  const rule = ruleOf(data, team.id);
  const serial = useSerialSaves<Housekeeping>(rule);
  const stored = useRef(rule);
  stored.current = rule;
  const [preview, setPreview] = useState<Preview | string | null>(null);
  const store = (change: Partial<Housekeeping>) => serial(async (base) => {
    const next = { ...base, ...change };
    const result = await call(`/api/settings/teams/${team.id}/housekeeping`, "PUT", next);
    stored.current = ruleOf(result, team.id);
    return stored.current;
  });
  async function show() {
    // A change typed a moment ago is stored first, so the preview reads what the next run will use.
    await flushUnsaved(false);
    try {
      setPreview(await fetchJson(`/api/settings/teams/${team.id}/housekeeping/preview`, housekeepingPreviewSchema, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(stored.current),
      }));
    } catch (cause) { setPreview(cause instanceof Error ? cause.message : "The preview could not be loaded."); }
  }
  return (
    <section className="team-block" aria-label="Auto-close and auto-archive">
      <h2 className="group-heading">Auto-close and auto-archive</h2>
      <NumberField label="Close after" suffix="days without activity" value={rule.closeAfterDays} min={1} max={3650} save={(next) => store({ closeAfterDays: next })} />
      <NumberField label="Archive after" suffix="days after closing" value={rule.archiveAfterDays} min={1} max={3650} save={(next) => store({ archiveAfterDays: next })} />
      <SwitchField label="Never auto-close issues labelled Bug" value={rule.exemptBugs} save={(next) => store({ exemptBugs: next })} />
      <div className="confirm-actions"><button type="button" className="button-quiet" onClick={() => void show()}>Preview</button></div>
      {typeof preview === "string" && <p className="confirm-error" role="alert">{preview}</p>}
      {preview && typeof preview !== "string" && (
        <div className="housekeeping-preview" role="status" aria-label={`Preview for ${team.name}`}>
          {(["close", "archive"] as const).map((kind) => (
            <div key={kind}>
              <h3>{kind === "close" ? `Would close ${preview.close.length}` : `Would archive ${preview.archive.length}`}</h3>
              {preview[kind].length ? <ul>{preview[kind].map((issue) => (
                <li key={issue.id}><a href={`/app/issues/${issue.identifier}`}>{issue.identifier}</a> {issue.title} · {issue.days} days</li>
              ))}</ul> : <p>Nothing yet.</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
