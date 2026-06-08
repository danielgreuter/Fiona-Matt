name: Team-LIE Zoom-Modal Patch

on:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  patch:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Patch index.html
        run: python3 .github/scripts/patch_lieteamzoom.py

      - name: Commit & Push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          if git diff --quiet; then
            echo "Keine Aenderungen (bereits gepatcht)."
          else
            git add index.html
            git commit -m "Team-LIE: Zoom-in-Modal mit Details + Disziplin-Chart"
            git push
          fi
