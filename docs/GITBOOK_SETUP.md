# GitBook Setup

Connect the GitBook space to the sof-beta monorepo.

## Steps

1. Go to your GitBook space settings
2. Navigate to Git Sync (or Integrations > GitHub)
3. Connect to GitHub repo: `SecondOrder-fun/sof-beta`
4. Set **content directory** to: `docs/`
5. Set **branch** to: `main`
6. Save and wait for initial sync

## Verification

1. Push a small edit to any doc file (e.g., add a line to `docs/README.md`)
2. Wait 1-2 minutes for GitBook to sync
3. Verify the change appears on the GitBook space
4. Check that the table of contents (from `SUMMARY.md`) renders correctly
5. Spot-check a few nested pages (e.g., `01-product/tokenomics.md`)

## Troubleshooting

- If pages show "Page not found", check that `SUMMARY.md` links match actual file paths
- If sync doesn't trigger, verify the GitHub app has access to the sof-beta repo
- The `.gitbook.yaml` config uses `root: ./` which is relative to the content directory
