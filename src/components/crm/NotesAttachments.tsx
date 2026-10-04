import { Paperclip } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime, type DateFormat } from "@/lib/format";
import { addNoteAction, deleteAttachmentAction, deleteNoteAction, uploadAttachmentAction } from "@/server/modules/deals/actions";
import { RelatedListCard } from "./record";

interface NoteLine {
  id: string;
  body: string;
  at: string;
  author: string;
  mine: boolean;
}
interface AttachmentLine {
  id: string;
  fileName: string;
  size: number;
  at: string;
  uploadedBy: string;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Notes related list. Notes inherit the parent record's brand and region. */
export function NotesCard({ entity, entityId, path, notes, canEdit, dateFormat }: { entity: string; entityId: string; path: string; notes: NoteLine[]; canEdit: boolean; dateFormat: DateFormat }) {
  return (
    <RelatedListCard id="notes" title="Notes" count={notes.length}>
      <div className="space-y-3">
        {canEdit ? (
          <ActionForm action={addNoteAction} className="flex gap-2">
            <input type="hidden" name="entity" value={entity} />
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="path" value={path} />
            <Input name="body" placeholder="Add a note…" required maxLength={5000} aria-label="New note" />
            <SubmitButton size="sm">Add</SubmitButton>
          </ActionForm>
        ) : null}
        <ul className="space-y-2" data-testid="notes-list">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-border p-2">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                {n.author} · {formatDateTime(n.at, dateFormat)}
                {n.mine ? (
                  <ActionForm action={deleteNoteAction} confirm="Delete this note?" className="ml-auto">
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="path" value={path} />
                    <button type="submit" className="underline">
                      delete
                    </button>
                  </ActionForm>
                ) : null}
              </div>
            </li>
          ))}
          {notes.length === 0 ? <li className="text-text-muted">No notes yet.</li> : null}
        </ul>
      </div>
    </RelatedListCard>
  );
}

/** Attachments related list. Downloads go through the brand-scoped /api/v1/attachments/[id] route. */
export function AttachmentsCard({ entity, entityId, path, attachments, canEdit, dateFormat }: { entity: string; entityId: string; path: string; attachments: AttachmentLine[]; canEdit: boolean; dateFormat: DateFormat }) {
  return (
    <RelatedListCard id="attachments" title="Attachments" count={attachments.length}>
      <div className="space-y-3">
        {canEdit ? (
          <ActionForm action={uploadAttachmentAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="entity" value={entity} />
            <input type="hidden" name="entityId" value={entityId} />
            <input type="hidden" name="path" value={path} />
            <Input type="file" name="file" required className="max-w-sm" aria-label="File to attach" />
            <SubmitButton size="sm" variant="outline">
              Attach
            </SubmitButton>
            <span className="text-xs text-text-muted">PDF, images, Word / Excel, text – up to 10 MB</span>
          </ActionForm>
        ) : null}
        <ul className="divide-y divide-border" data-testid="attachments-list">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1.5">
              <Paperclip className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
              <a href={`/api/v1/attachments/${a.id}`} className="flex-1 truncate font-medium text-primary hover:underline">
                {a.fileName}
              </a>
              <span className="text-xs text-text-muted">
                {kb(a.size)} · {a.uploadedBy} · {formatDateTime(a.at, dateFormat)}
              </span>
              {canEdit ? (
                <ActionForm action={deleteAttachmentAction} confirm={`Remove ${a.fileName}?`}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="path" value={path} />
                  <Button size="sm" variant="ghost" type="submit">
                    Remove
                  </Button>
                </ActionForm>
              ) : null}
            </li>
          ))}
          {attachments.length === 0 ? <li className="py-1 text-text-muted">No attachments.</li> : null}
        </ul>
      </div>
    </RelatedListCard>
  );
}
