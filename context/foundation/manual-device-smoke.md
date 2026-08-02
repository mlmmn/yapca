# Manual device photo smoke

This is the release-time complement to `pnpm test:http` for Risk #7. HTTP
coverage starts with a formed request; it cannot prove that the client island
kept the selected file or that people receive useful feedback. Run every row
on at least one iPhone and one Android device before release.

Record the device, OS, browser, and outcome beside each row. A failed row is a
release bug unless its stated failure meaning identifies an environment issue.

## iPhone

- [ ] **Camera or library selection:** Select a photo from the camera or photo library, then confirm the preview matches the chosen file. **Failure means:** the browser or client island lost, replaced, or misrepresented the selected file before submission.
- [ ] **Save and reload:** Save the plant, navigate away, return to its details, and confirm the image reloads from the private bucket. **Failure means:** the upload, plant-to-object link, authenticated image retrieval, or saved-image rendering is broken.
- [ ] **Unsupported or oversized retry:** Select a HEIC or oversized photo, confirm actionable guidance appears, verify the other form fields remain intact, then select a supported photo and save successfully. **Failure means:** the rejected-file path is opaque, destroys entered work, or prevents recovery.
- [ ] **EXIF orientation:** Select an EXIF-rotated JPEG and confirm its orientation is acceptable in both the preview and the saved image. **Failure means:** the device/browser preview or persisted-image rendering handles orientation unacceptably.

## Android

- [ ] **Camera or library selection:** Select a photo from the camera or photo library, then confirm the preview matches the chosen file. **Failure means:** the browser or client island lost, replaced, or misrepresented the selected file before submission.
- [ ] **Save and reload:** Save the plant, navigate away, return to its details, and confirm the image reloads from the private bucket. **Failure means:** the upload, plant-to-object link, authenticated image retrieval, or saved-image rendering is broken.
- [ ] **Unsupported or oversized retry:** Select a HEIC or oversized photo, confirm actionable guidance appears, verify the other form fields remain intact, then select a supported photo and save successfully. **Failure means:** the rejected-file path is opaque, destroys entered work, or prevents recovery.
- [ ] **EXIF orientation:** Select an EXIF-rotated JPEG and confirm its orientation is acceptable in both the preview and the saved image. **Failure means:** the device/browser preview or persisted-image rendering handles orientation unacceptably.
