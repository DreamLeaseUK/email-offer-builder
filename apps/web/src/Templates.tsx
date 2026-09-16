/**
 * Master-admin only: author the Emma-approved compliance templates that render() locks into every email.
 * Approved templates are immutable — editing forks a new draft version (see apps/api/src/templates.ts).
 * Shown only when /me returns role: admin (App.tsx gates the tab).
 */
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, Input, Textarea } from 'dreamlease-design-system';
import type { ContractType, Template } from '@offer-mailer/schema';
import { api, type TemplateInput } from './api';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const AUDIENCES: { key: ContractType; label: string; hint: string }[] = [
  { key: 'personal', label: 'PCH — Personal contract hire', hint: 'e.g. Personal contract hire' },
  { key: 'business', label: 'BCH — Business contract hire', hint: 'e.g. Business contract hire' },
  { key: 'salary_sacrifice', label: 'Salary sacrifice', hint: 'e.g. Salary sacrifice' },
];

const toParas = (text: string): string[] => text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
const fromParas = (arr: string[] | undefined): string => (arr ?? []).join('\n\n');

interface BlockForm { title: string; paras: string }
interface Form { name: string; blocks: Record<ContractType, BlockForm>; optOutLine: string; companyLine: string }

const emptyBlocks = (): Record<ContractType, BlockForm> => ({ personal: { title: '', paras: '' }, business: { title: '', paras: '' }, salary_sacrifice: { title: '', paras: '' } });
const blankForm = (): Form => ({ name: '', blocks: emptyBlocks(), optOutLine: '', companyLine: '' });
const formFrom = (t: Template): Form => ({
  name: t.name,
  blocks: AUDIENCES.reduce((acc, a) => {
    acc[a.key] = { title: t.complianceBlocks[a.key]?.title ?? '', paras: fromParas(t.complianceBlocks[a.key]?.paragraphs) };
    return acc;
  }, emptyBlocks()),
  optOutLine: t.footer.optOutLine,
  companyLine: t.footer.companyLine,
});
const toBody = (f: Form): TemplateInput => ({
  name: f.name.trim(),
  complianceBlocks: AUDIENCES.reduce((acc, a) => {
    acc[a.key] = { title: f.blocks[a.key].title.trim(), paragraphs: toParas(f.blocks[a.key].paras) };
    return acc;
  }, {} as TemplateInput['complianceBlocks']),
  footer: { optOutLine: f.optOutLine.trim(), companyLine: f.companyLine.trim() },
});

const statusTone = (s: Template['status']): 'green' | 'sky' | 'grey' => (s === 'approved' ? 'green' : s === 'draft' ? 'sky' : 'grey');

export function Templates() {
  const [list, setList] = useState<Template[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // null = create a new draft
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listTemplates()
      .then((r) => setList(r.templates))
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  const startNew = () => { setEditingId(null); setForm(blankForm()); setNotice(''); setError(''); };
  const startEdit = (t: Template) => { setEditingId(t.id); setForm(formFrom(t)); setNotice(''); setError(''); };
  const startNewVersion = (t: Template) => { setEditingId(null); setForm(formFrom(t)); setNotice(`Editing a new draft version of “${t.name}”. Save to create it.`); setError(''); };
  const cancel = () => { setForm(null); setEditingId(null); setError(''); };

  const patchBlock = (key: ContractType, patch: Partial<BlockForm>) =>
    setForm((f) => (f ? { ...f, blocks: { ...f.blocks, [key]: { ...f.blocks[key], ...patch } } } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true); setError('');
    try {
      const body = toBody(form);
      if (editingId) await api.updateTemplate(editingId, body);
      else await api.createTemplate(body);
      setForm(null); setEditingId(null); setNotice('Saved.');
      await load();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  const act = async (label: string, run: () => Promise<unknown>, after: string) => {
    setBusy(true); setError('');
    try { await run(); await load(); setNotice(after); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const publish = (t: Template) => {
    if (!window.confirm(`Publish “${t.name}” v${t.version}? It becomes the live compliance template and can no longer be edited.`)) return;
    void act('publish', () => api.publishTemplate(t.id), `Published “${t.name}” v${t.version}.`);
  };
  const retire = (t: Template) => {
    if (!window.confirm(`Retire “${t.name}” v${t.version}?`)) return;
    void act('retire', () => api.retireTemplate(t.id), `Retired “${t.name}” v${t.version}.`);
  };

  return (
    <div className="list">
      <section className="panel">
        <div className="tmpl__head">
          <h2 className="dl-h4">Templates</h2>
          {!form && <Button size="sm" onClick={startNew}>New template</Button>}
        </div>
        <p className="dl-small app__muted">The approved compliance blocks and footer that lock into every email. Approved templates can’t be edited — publish a new version instead.</p>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && !error && <p className="dl-small app__muted">{notice}</p>}
        {!list && !error && <p className="dl-small app__muted">Loading…</p>}
        {list && list.length === 0 && !form && <p className="dl-small app__muted">No templates yet. Create one — it starts as a draft you can edit, then publish.</p>}

        {list && !form && (
          <div className="tmpl-list">
            {list.map((t) => (
              <div key={t.id} className="tmpl">
                <div className="tmpl__row">
                  <div>
                    <p className="tmpl__name">{t.name} <span className="dl-small app__muted">v{t.version}</span></p>
                    <p className="dl-small app__muted tmpl__meta">
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      {t.approvedBy ? <span>approved by {t.approvedBy}</span> : null}
                      <span>markup v{t.markupVersion}</span>
                    </p>
                  </div>
                  <div className="tmpl__actions">
                    {t.status === 'draft' && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => startEdit(t)} disabled={busy}>Edit</Button>
                        <Button size="sm" onClick={() => publish(t)} disabled={busy}>Publish</Button>
                      </>
                    )}
                    {t.status === 'approved' && <Button variant="outline" size="sm" onClick={() => startNewVersion(t)} disabled={busy}>New version</Button>}
                    {t.status !== 'retired' && <Button variant="ghost" size="sm" onClick={() => retire(t)} disabled={busy}>Retire</Button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {form && (
        <section className="panel">
          <h2 className="dl-h4">{editingId ? 'Edit draft' : 'New template'}</h2>
          <Field label="Template name">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Autumn 2026" />}</Field>
          {AUDIENCES.map((a) => (
            <div key={a.key} className="tmpl__block">
              <h3 className="tmpl__h">{a.label}</h3>
              <Field label="Block title">{(id) => <Input id={id} value={form.blocks[a.key].title} onChange={(e) => patchBlock(a.key, { title: e.target.value })} placeholder={a.hint} />}</Field>
              <Field label="Paragraphs" help="Separate each legal paragraph with a blank line.">{(id) => <Textarea id={id} rows={5} value={form.blocks[a.key].paras} onChange={(e) => patchBlock(a.key, { paras: e.target.value })} />}</Field>
            </div>
          ))}
          <div className="tmpl__block">
            <h3 className="tmpl__h">Footer</h3>
            <Field label="Opt-out line">{(id) => <Input id={id} value={form.optOutLine} onChange={(e) => setForm({ ...form, optOutLine: e.target.value })} placeholder="Don’t want offers from DreamLease? Reply to this email and tell us, and we’ll stop." />}</Field>
            <Field label="Company line">{(id) => <Input id={id} value={form.companyLine} onChange={(e) => setForm({ ...form, companyLine: e.target.value })} placeholder="DreamLease Ltd, [registered address], registered in England and Wales no. [00000000]." />}</Field>
          </div>
          <div className="tmpl__formactions">
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save draft' : 'Create draft'}</Button>
            <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
        </section>
      )}
    </div>
  );
}
