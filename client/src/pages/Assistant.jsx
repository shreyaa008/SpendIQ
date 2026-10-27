import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Trash2, Info } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Banner, Chip, ConfirmDialog, PageHeader, Panel, EmptyState } from '../components/ui/index.jsx';

const LABEL = { actual: ['pos', 'Actual'], estimate: ['gold', 'Estimate'], recommendation: ['brand', 'Suggestion'] };
const EXAMPLES = ['How much did I spend this month?', 'Compare my spending this month with last month', 'Which category has the highest spending?', 'Am I likely to exceed my budget?', 'Where can I reduce spending?', 'Summarize my financial situation'];

function BotMessage({ m, onAsk }) {
  const meta = m.meta;
  const facts = meta?.facts ?? [];
  return (
    <div className="msg msg-bot">
      <div className="bubble">
        {meta?.usedAI ? (
          <>{m.content.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            <details><summary className="small muted" style={{ cursor: 'pointer' }}>How this was calculated</summary><div className="stack-sm" style={{ marginTop: 8 }}>{facts.map((f, i) => <div className="fact" key={i}><Chip tone={LABEL[f.type][0]}>{LABEL[f.type][1]}</Chip><span className="small">{f.text}</span></div>)}{meta.basis?.map((b) => <p key={b} className="faint small">{b}</p>)}</div></details></>
        ) : facts.length > 0 ? (
          <>{facts.map((f, i) => <div className="fact" key={i}><Chip tone={LABEL[f.type][0]}>{LABEL[f.type][1]}</Chip><span>{f.text}</span></div>)}
            {meta.basis?.length > 0 && <details><summary className="small muted" style={{ cursor: 'pointer' }}>How this was calculated</summary>{meta.basis.map((b) => <p key={b} className="faint small" style={{ marginTop: 6 }}>{b}</p>)}</details>}</>
        ) : <p>{m.content}</p>}
        {meta?.aiNote && <p className="faint small"><Info size={12} style={{ verticalAlign: -1 }} /> {meta.aiNote}</p>}
      </div>
      {meta?.suggestions?.length > 0 && <div className="suggestions">{meta.suggestions.map((s) => <button key={s} className="btn btn-secondary btn-sm" onClick={() => onAsk(s)}>{s}</button>)}</div>}
    </div>
  );
}

export default function Assistant() {
  useDocumentTitle('AI assistant');
  const toast = useToast();
  const { data: status } = useAsync(() => api.get('/chat/status'), []);
  const { data: history, loading } = useAsync(() => api.get('/chat/history'), []);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { if (history) setMessages(history); }, [history]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

  const ask = async (q) => {
    const message = (q ?? text).trim();
    if (!message || sending) return;
    setError(''); setText(''); setSending(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: message }]);
    try { const r = await api.post('/chat', { message }); setMessages((m) => [...m, r.data]); }
    catch (e) { setError(e.message); setText(message); setMessages((m) => m.slice(0, -1)); }
    finally { setSending(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
  const clear = async () => { try { await api.del('/chat/history'); setMessages([]); setConfirmClear(false); toast.info('Conversation cleared.'); } catch (e) { toast.error(e.message); } };

  return (
    <>
      <PageHeader title="AI assistant" subtitle="Ask about your own spending. Answers come from your recorded data." actions={<>
        {status && <Chip tone={status.aiEnabled ? 'brand' : undefined}>{status.aiEnabled ? 'AI wording on' : 'Rule-based answers'}</Chip>}
        {messages.length > 0 && <Button variant="secondary" size="sm" icon={Trash2} onClick={() => setConfirmClear(true)}>Clear</Button>}</>} />
      <Panel className="chat" >
        <div className="chat-log" aria-live="polite" aria-label="Conversation">
          {loading && !messages.length ? <p className="muted">Loading conversation…</p> : messages.length === 0 ? (
            <EmptyState icon={Sparkles} title="Ask me about your money" action={<div className="suggestions" style={{ justifyContent: 'center' }}>{EXAMPLES.map((e) => <button key={e} className="btn btn-secondary btn-sm" onClick={() => ask(e)}>{e}</button>)}</div>}>I can total and compare your spending, check budgets, look at recurring payments and goals, and estimate what's ahead. I only use your own records, and I'll say so when there isn't enough data.</EmptyState>
          ) : messages.map((m) => m.role === 'user' ? <div key={m.id} className="msg msg-user">{m.content}</div> : <BotMessage key={m.id} m={m} onAsk={ask} />)}
          {sending && <div className="msg msg-bot"><div className="bubble" aria-label="Assistant is typing"><span className="typing"><i /><i /><i /></span></div></div>}
          <div ref={endRef} />
        </div>
        <div className="stack-sm">
          {error && <Banner tone="neg">{error}</Banner>}
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <textarea className="textarea grow" rows={1} placeholder="e.g. How much did I spend on food last month?" aria-label="Your question" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} maxLength={500} style={{ resize: 'none' }} />
            <Button icon={Send} loading={sending} disabled={!text.trim()} onClick={() => ask()} aria-label="Send question">Ask</Button>
          </div>
          <p className="faint small">Figures are calculated from your data. Estimates and suggestions are labelled, and are not financial advice.</p>
        </div>
      </Panel>
      {confirmClear && <ConfirmDialog title="Clear conversation?" confirmLabel="Clear" message="Your saved chat history will be deleted. Your financial data is not affected." onConfirm={clear} onCancel={() => setConfirmClear(false)} />}
    </>
  );
}