import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageTitleRow, StatusPill } from "@/components/crm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { managedBrands } from "@/server/access/brand-tag";
import { hasPermission } from "@/server/access/can";
import { isAccessError } from "@/server/access/errors";
import { deleteSolutionAction, saveSolutionAction } from "@/server/modules/cases/actions";
import { canManageSolution, getSolution, isSolutionEditor, listSolutions } from "@/server/modules/cases/admin";
import { getDirectory } from "@/server/modules/org/queries";
import { requireContext } from "@/server/request";

export const metadata = { title: "Solutions" };
type SP = { q?: string; id?: string; edit?: string; new?: string };

/**
 * Solutions knowledge base: group articles for everyone, brand articles only for that brand's users.
 * `?id=` reads an article, `?edit=` / `?new=1` opens the editor (brand managers, management, administrators).
 */
export default async function SolutionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!hasPermission(ctx, "cases", "read")) forbidden();
  const [articles, dir] = await Promise.all([listSolutions(ctx, { q: sp.q }), getDirectory(ctx)]);
  const openId = sp.edit ?? sp.id;
  const article = openId
    ? await getSolution(ctx, openId).catch((e) => {
        if (isAccessError(e)) notFound(); // missing, another brand's, or an unpublished draft
        throw e;
      })
    : null;
  const editor = isSolutionEditor(ctx);
  const editing = !!sp.new || (!!sp.edit && !!article && canManageSolution(ctx, article.brandId));
  const ownBrands = (ctx.isAdmin || ctx.scope === "ALL" ? dir.brands : dir.brands.filter((b) => managedBrands(ctx).includes(b.id))).filter((b) => b.status !== "INACTIVE");
  const canGroup = canManageSolution(ctx, null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitleRow
        title="Solutions"
        left={
          <Link href="/cases" className="text-sm text-primary hover:underline">
            ← Cases
          </Link>
        }
        actions={
          editor ? (
            <Button asChild>
              <Link href="/cases/solutions?new=1">New Article</Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-border bg-surface">
          <form method="get" className="flex gap-2 border-b border-border p-3">
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search articles" aria-label="Search articles" />
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
          {articles.length === 0 ? (
            <EmptyState title="No articles" text="Brand articles are visible to that brand's users, group articles to everyone." />
          ) : (
            <ul className="divide-y divide-border" data-testid="solutions-list">
              {articles.map((s) => (
                <li key={s.id} className="px-3 py-2 text-[13px]">
                  <Link href={`/cases/solutions?id=${s.id}`} className="font-medium text-primary hover:underline" aria-current={s.id === article?.id ? "true" : undefined}>
                    {s.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
                    <span>{s.brand?.code ?? "Group"}</span>
                    {!s.published ? <StatusPill tone="warning">Draft</StatusPill> : null}
                    {s.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1">
                        {t}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-lg border border-border bg-surface p-4" data-testid="solution-pane">
          {editing ? (
            <ActionForm key={article?.id ?? "new"} action={saveSolutionAction} className="space-y-3">
              {article && sp.edit ? <input type="hidden" name="id" value={article.id} /> : null}
              <div className="space-y-1">
                <Label htmlFor="s-brand">Visible to</Label>
                {article && sp.edit ? (
                  <Input id="s-brand" value={article.brand ? `${article.brand.code} users` : "Everyone (group)"} readOnly disabled />
                ) : (
                  <Select id="s-brand" name="brandId" className="w-full" defaultValue={canGroup ? "" : (ownBrands[0]?.id ?? "")}>
                    {canGroup ? <option value="">Everyone (group article)</option> : null}
                    {ownBrands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} users only
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="s-title">Title</Label>
                <Input id="s-title" name="title" required maxLength={200} defaultValue={sp.edit ? (article?.title ?? "") : ""} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="s-body">Article</Label>
                <textarea id="s-body" name="body" rows={12} required maxLength={20000} defaultValue={sp.edit ? (article?.body ?? "") : ""} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="s-tags">Tags (comma separated – case types such as “warranty” make it a suggestion on matching cases)</Label>
                <Input id="s-tags" name="tags" defaultValue={sp.edit ? (article?.tags.join(", ") ?? "") : ""} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="published" defaultChecked={sp.edit ? article?.published : true} /> Published
              </label>
              <div className="flex gap-2">
                <SubmitButton size="sm">Save article</SubmitButton>
                <Button asChild size="sm" variant="outline">
                  <Link href={article ? `/cases/solutions?id=${article.id}` : "/cases/solutions"}>Cancel</Link>
                </Button>
              </div>
            </ActionForm>
          ) : article ? (
            <article>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{article.title}</h2>
                <StatusPill>{article.brand ? `${article.brand.code} only` : "Group"}</StatusPill>
                {!article.published ? <StatusPill tone="warning">Draft</StatusPill> : null}
                {canManageSolution(ctx, article.brandId) ? (
                  <span className="ml-auto flex items-center gap-2">
                    <Link href={`/cases/solutions?edit=${article.id}`} className="text-xs font-semibold text-primary hover:underline">
                      Edit
                    </Link>
                    <ActionForm action={deleteSolutionAction} confirm="Delete this article?">
                      <input type="hidden" name="id" value={article.id} />
                      <button type="submit" className="text-xs text-text-muted underline">
                        Delete
                      </button>
                    </ActionForm>
                  </span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{article.body}</div>
            </article>
          ) : (
            <p className="text-[13px] text-text-muted">Choose an article on the left.</p>
          )}
        </section>
      </div>
    </div>
  );
}
