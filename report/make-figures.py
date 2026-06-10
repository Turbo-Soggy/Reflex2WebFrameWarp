# ---------------------------------------------------------------------------
# report/make-figures.py — render the report figures from the CSVs
# ---------------------------------------------------------------------------
# Run after: node report/make-figure-data.mjs
# Outputs report/figures/fig{1,2,3}-*.png at print resolution.
# ---------------------------------------------------------------------------
import csv
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

FIGDIR = 'report/figures'


def read_csv(path):
    rows, meta = [], {}
    with open(path, newline='') as f:
        for row in csv.reader(f):
            if not row:
                continue
            if row[0].startswith('#'):
                meta[row[0].lstrip('# ')] = float(row[1])
            else:
                rows.append(row)
    header, data = rows[0], rows[1:]
    return header, data, meta


# --- Figure 1: the carrying figure -------------------------------------------
header, data, _ = read_csv(f'{FIGDIR}/lag-sweep.csv')
lag = [float(r[0]) for r in data]
nowarp_mean = [float(r[1]) for r in data]
nowarp_p95 = [float(r[2]) for r in data]
warp = [float(r[3]) for r in data]

fig, ax = plt.subplots(figsize=(6.5, 4.0))
ax.plot(lag, nowarp_mean, 'o-', color='#d9534f', label='Without warp (mean)')
ax.fill_between(lag, nowarp_mean, nowarp_p95, color='#d9534f', alpha=0.15,
                label='Without warp (mean to p95)')
ax.plot(lag, warp, 's-', color='#2e75b6', label='With warp (one display interval)')
ax.set_xlabel('Injected pipeline delay (ms)')
ax.set_ylabel('View-direction latency (ms)')
ax.set_title('View-direction latency vs injected delay (60 Hz display)')
ax.grid(True, alpha=0.3)
ax.legend()
fig.tight_layout()
fig.savefig(f'{FIGDIR}/fig1-lag-sweep.png', dpi=150)
plt.close(fig)

# --- Figure 2: guard-band exhaustion ------------------------------------------
header, data, meta = read_csv(f'{FIGDIR}/onset-sweep.csv')
v = [float(r[0]) for r in data]
clamp = [float(r[1]) for r in data]
err = [float(r[2]) for r in data]

fig, ax = plt.subplots(figsize=(6.5, 4.0))
ax.plot(v, clamp, 'o-', color='#2e75b6', label='Clamp rate (fraction of ticks)')
ax2 = ax.twinx()
ax2.plot(v, err, 's-', color='#d9534f', label='Residual error p95 (deg)')
ax.axvspan(meta['lower'], meta['upper'], color='#999999', alpha=0.2,
           label=f"Analytic onset bounds [{meta['lower']:.0f}, {meta['upper']:.0f}] deg/s")
ax.set_xlabel('Constant angular velocity (deg/s)')
ax.set_ylabel('Clamp rate', color='#2e75b6')
ax2.set_ylabel('Residual view-direction error p95 (deg)', color='#d9534f')
ax.set_title('Guard-band exhaustion: predicted bounds vs measured onset')
ax.grid(True, alpha=0.3)
lines1, labels1 = ax.get_legend_handles_labels()
lines2, labels2 = ax2.get_legend_handles_labels()
ax.legend(lines1 + lines2, labels1 + labels2, loc='upper left')
fig.tight_layout()
fig.savefig(f'{FIGDIR}/fig2-onset.png', dpi=150)
plt.close(fig)

# --- Figure 3: adaptive guard band --------------------------------------------
header, data, _ = read_csv(f'{FIGDIR}/adaptive.csv')
traces = []
fixed_cost, adaptive_cost, fixed_clamp, adaptive_clamp = [], [], [], []
for r in data:
    if r[1] == 'fixed-0.12':
        traces.append(r[0])
        fixed_cost.append(float(r[2]))
        fixed_clamp.append(float(r[3]))
    else:
        adaptive_cost.append(float(r[2]))
        adaptive_clamp.append(float(r[3]))

x = range(len(traces))
w = 0.35
fig, ax = plt.subplots(figsize=(6.5, 4.0))
b1 = ax.bar([i - w / 2 for i in x], fixed_cost, w, color='#999999', label='Fixed 0.12')
b2 = ax.bar([i + w / 2 for i in x], adaptive_cost, w, color='#2e75b6', label='Adaptive')
ax.axhline(1.0, color='black', linewidth=0.8, linestyle='--')
ax.text(len(traces) - 0.5, 1.02, 'no guard band', fontsize=8)
for i, (bf, ba) in enumerate(zip(b1, b2)):
    ax.text(bf.get_x() + bf.get_width() / 2, bf.get_height() + 0.03,
            f'clamp\n{fixed_clamp[i]:.1%}', ha='center', fontsize=8)
    ax.text(ba.get_x() + ba.get_width() / 2, ba.get_height() + 0.03,
            f'clamp\n{adaptive_clamp[i]:.1%}', ha='center', fontsize=8)
ax.set_xticks(list(x))
ax.set_xticklabels(traces)
ax.set_ylabel('Rendered pixels (relative to display)')
ax.set_ylim(0, max(adaptive_cost + fixed_cost) + 0.5)
ax.set_title('Guard-band cost: fixed vs velocity-adaptive (clamp rate annotated)')
ax.legend()
fig.tight_layout()
fig.savefig(f'{FIGDIR}/fig3-adaptive.png', dpi=150)
plt.close(fig)

print('wrote fig1-lag-sweep.png, fig2-onset.png, fig3-adaptive.png')
