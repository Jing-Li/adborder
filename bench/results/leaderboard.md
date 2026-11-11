# Skill Pack Leaderboard

_Generated 2026-11-11T02:58:03.521Z · model claude-sonnet-4-20250514 · 3 trials/case_

**Model reference (Text Arena · hf-text, 2026-10-22)**: Claude Sonnet 4 (Thinking 32K, 20250514) — rank 162, score 1401.9±4, Anthropic · exact match

**Secondary reference (hf-search · hf-search, 2026-10-13)**: claude-sonnet-4-6-search — rank 12, score 1220.5±5 · closest relative of the benchmarked model


## Arena data source

- **Where**: arena.ai itself sits behind a bot gate, so the snapshots are read from public mirrors — the arena.ai family from the public GitHub mirror (github-raw:lmarena-hf, github-raw) with a REST fallback for whatever the mirror is missing, and the LMArena family from the GitHub mirror of LMArena's public dataset (CC BY 4.0). The two families are different products on different scales, so a score only means something inside its own board
- **Freshness**: newest snapshot 2026-10-26 (16 days old). The upstream arena.ai crawl stopped publishing on 2026-10-08, so every refresh also asks the live source for the days the mirror is missing
- **Per family**: LMArena · HF dataset — 59 boards, 70 snapshots, newest 2026-10-26 (16 days old); arena.ai — 11 boards, 556 snapshots, newest 2026-10-07 (35 days old)
- **Depth**: 626 snapshots across 70 boards — a dense daily window at each board's newest date, a weekly tail behind it, and the full history of the board that still lists the benchmarked model
- **Two anchors**: the exact entry for the benchmarked model and the closest relative in the freshest snapshot are reported side by side — neither silently replaces the other

## Overall Ranking

| # | Rank Spread | Pack | Rating | Score | Trials | Avg Tokens |
|---|---|---|---|---|---|---|
| 1 | 1·2 | mine | 648 (510~740) | 93.3% | 15 | 142,544 |
| 2 | 1·5 | superpowers | 506 (307~673) | 80.0% | 15 | 111,256 |
| 3 | 2·5 | skills | 314 (121~445) | 60.0% | 15 | 98,653 |
| 4 | 2·5 | impeccable | 302 (164~405) | 60.0% | 15 | 92,297 |
| 5 | 2·6 | taste-skill | 243 (-11~470) | 53.3% | 15 | 75,581 |
| 6 | 5·6 | baseline | 0 (-81~81) | 33.3% | 15 | 90,185 |

## Per-Case Breakdown

| Case | mine | superpowers | skills | impeccable | taste-skill | baseline |
|---|---|---|---|---|---|---|
| case-001 | 100% | 100% | 67% | 67% | 33% | 33% |
| case-002 | 67% | 100% | 67% | 33% | 33% | 33% |
| case-003 | 100% | 67% | 67% | 67% | 67% | 33% |
| case-004 | 100% | 67% | 67% | 67% | 33% | 33% |
| case-005 | 100% | 67% | 33% | 67% | 100% | 33% |

## Methodology

- **model**: Bradley-Terry over pairwise case wins
- **ci**: Bootstrap over cases, B=2000, 95% percentile interval
- **rank_spread**: Rank range consistent with 95% CI (LMArena convention)
- **scale**: Elo-like, 400/ln(10) scaling
