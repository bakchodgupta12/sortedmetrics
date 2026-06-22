# Brand assets — drop your Sorted logo SVGs here

The app loads the logos from this `public/` folder by **exact filename**.
Right now there are two **placeholder** SVGs in here. To use the real brand
logos, replace each placeholder with your official SVG, keeping the **same
filename**. No code changes are needed.

## Files to replace

| Filename                      | What it is                          | Where it shows                          | Which variant to upload                          |
| ----------------------------- | ----------------------------------- | --------------------------------------- | ----------------------------------------------- |
| `public/sorted-wordmark.svg`  | The Sorted **wordmark**             | Login page + top header bar             | **Primary-blue wordmark** (for light backgrounds) |
| `public/sorted-mark.svg`      | The Sorted **logo mark** (icon)     | Browser tab favicon                     | The standalone logo mark / icon                 |

Both backgrounds in this app are light (cream / white), so use the
**primary-blue (dark) wordmark**, not the white/reversed one.

## How to upload on GitHub (no git needed)

1. Open the repo on GitHub and navigate into the `public/` folder.
2. Click **Add file → Upload files**.
3. Drag in your SVGs. Make sure they are named exactly `sorted-wordmark.svg`
   and `sorted-mark.svg` (rename them before uploading if needed).
4. Commit to the branch `claude/pensive-curie-yg81s5`.
5. Vercel will redeploy automatically; the real logos will appear.

> Tip: if your file has a different name, either rename it to match, or tell me
> the name you used and I'll point the app at it.
