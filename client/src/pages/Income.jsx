
import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync } from '../hooks/index.js';
import { Panel, TextField, Button } from '../components/ui/index.jsx';
import { currentPeriod, periodLabel } from '../utils/format.js';

export default function Income() {
  const { user, money, updateProfile } = useAuth();
  const toast = useToast();

  const [period, setPeriod] = useState(currentPeriod());
  const [amount, setAmount] = useState('');
  const [warningThreshold, setWarningThreshold] = useState(
    String(user.warningThreshold ?? 80)
  );
  const [warningBusy, setWarningBusy] = useState(false);

  const { data, reload } = useAsync(async () => {
    const r = await api.get('/income', { period });
    setAmount(r.data.amount ?? '');
    return r;
  }, [period]);

  const save = async (e) => {
    e.preventDefault();

    if (amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
      return toast.error('Enter a valid amount');
    }

    try {
      await api.put('/income', { period, amount: Number(amount) });
      toast.success('Income saved.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const clear = async () => {
    try {
      await api.del('/income', { period });
      toast.info('Income cleared.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveWarning = async (e) => {
    e.preventDefault();

    const threshold = Number(warningThreshold);

    if (
      warningThreshold.trim() === '' ||
      !Number.isFinite(threshold) ||
      threshold < 1 ||
      threshold > 100
    ) {
      return toast.error('Budget warning must be between 1 and 100.');
    }

    setWarningBusy(true);

    try {
      await updateProfile({ warningThreshold: threshold });
      setWarningThreshold(String(threshold));
      toast.success('Budget warning saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWarningBusy(false);
    }
  };

  return (
    <div className="stack">
      <Panel
        title="Monthly income"
        subtitle="Used for net cash flow, savings estimates and balance. Leave empty if you'd rather not track it."
      >
        <form className="stack" onSubmit={save} noValidate>
          <div className="form-grid">
            <TextField
              label="Month"
              type="month"
              value={period}
              onChange={(e) => e.target.value && setPeriod(e.target.value)}
            />
            <TextField
              label="Income"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={
                data?.amount == null
                  ? `No income entered for ${periodLabel(period)}.`
                  : `Current: ${money(data.amount)}`
              }
            />
          </div>

          <div className="row">
            <Button type="submit">Save income</Button>
            {data?.amount != null && (
              <Button type="button" variant="ghost" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
        </form>
      </Panel>

      <Panel
        title="Budget warning"
        subtitle="Choose when SpendIQ should warn you as you approach your budget limit."
      >
        <form className="stack" onSubmit={saveWarning} noValidate>
          <TextField
            label="Default budget warning (%)"
            type="number"
            min="1"
            max="100"
            value={warningThreshold}
            onChange={(e) => setWarningThreshold(e.target.value)}
            hint="For example, 80 means a warning at 80% of your budget."
          />

          <div>
            <Button type="submit" loading={warningBusy}>
              Save budget warning
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}