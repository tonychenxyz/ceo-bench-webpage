# Native coding-agent trajectories

The October 2026 update adds the three most recent games for each of Opus 5.5,
GPT-6 Astra, Fable 5.1, and GPT-6 Sol. Opus/Fable use Claude Code; Astra/Sol use
Codex CLI. All use xhigh effort, seed 42, Modal, and AWS Bedrock Haiku judge
routing. Release revisions are per run, not assumed identical across batches.

## Sources and export

`import-native-runs.py --source /path/to/ceobench_runs` exports the September 28
integrity rerun and the two September 29 Sol/Fable batches. The earlier discarded
batch is excluded. Each game's stable website ID uses its simulation session ID.

The source is the harness's `logs/agent-001.jsonl`. Its SHA-256, line count, batch,
and run are recorded in each detail JSON. Matching Codex internal rollout events
supply file-change contents and timestamps; their filename and source line are
recorded on supplemented events. Stream metadata and encrypted thinking signatures
are not published. Auth keys and recognizable credentials are removed. The
JSONL download is a normalized public projection, not a byte-for-byte raw log.
Available agent text, tool inputs, outputs and source positions are retained.

Day grouping uses timestamped committed monitor snapshots and observed dashboard
or status responses. It is not an exact simulation-time timestamp for every tool.
Source segment and line retain the original chronology. Missing reasoning is
not reconstructed. Unavailable customer counts and turn metrics are not zero-filled.

Three extra-batch curves have complete daily ledger totals from financial audits.
Other curves use saved committed cash snapshots. Lines connect observations and
must not be interpreted as independent daily measurements. Every curve ends at
its exact day-500 ledger score; terminal day-504 cash is recorded separately.

## Extended-time Fable run

Session `fac1c37cb96f` hit its original 22-hour deadline on day 455 with
$917,408,327.35. Its original outcome remains `infrastructure_failed`.
The user authorized a separate extended-time continuation in a new container.
The same saved game and conversation resumed at day 455 without observed rollback
or a replacement game. Day-500 cash is $1,038,126,858.24. The website joins this
continuation to the original trajectory, counts it as one game, renders one continuous
curve, and retains the original outcome in the source data. Aggregate survival uses the completed trajectories. Cash statistics use all three
final day-500 scores, with bankrupt runs counted as zero.
The best Fable result came from another run that completed within the original limit.

No simulator restart was found in the other eleven run records. Astra's same-game
`resume` commands reconnected to the existing recorded PID/port. This is an
evidence finding, not a claim of exhaustive process instrumentation.

The first Fable run's complete agent trace was recovered, but its full workspace
archive was incomplete. That limitation remains in its source metadata.

## Validation

Run `node scripts/validate-native-runs.js`, `node scripts/validate-kimi-data.js`,
and `node scripts/validate-grok46-data.js`. Browser validation also covers desktop
and mobile layouts, all twelve detail pages, day-500 scores, chart links, and the
continuation boundary. Production is not updated by this feature branch.

The public presentation uses model-only plot labels, one leaderboard with effort
and cash mean ± population standard deviation, and concise trajectory pages.
Source metadata and downloadable artifacts remain unchanged by display choices.
