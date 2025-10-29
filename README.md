# VolleyVision (p5.js)

A p5.js prototype that annotates volleyball sets from video and reports metrics
(peak height, set width). Built for athlete self-analysis and empowerment.

## Run locally
- Open with VS Code, and ensure all three files are loaded in. 
- When in the 'index.html' folder, right click and choose the 'Open with Live Server' option. 
- Click once to start the video, then use:
  - **N** = end rep and hide until end
  - **Z** = undo point
  - **Space** = play/pause
  - **,** / **.** = frame step
  - **S** = restart hidden
- On first run, follow the on-screen calibration prompts (click net bottom/top at left and right antennae).
- Pause video once ball reaches the hands of the setter (second touch), and click the screen. Let the ball reach its peak height in the set, pause the video and click the screen where the ball is again. Finally, let the ball contact the hand of the hitter, pause the video and click the screen where the ball makes contact. Press the 'n' key to start a new rep. 

## Files
- `index.html` – page and p5.js includes
- `sketch.js` – all prototype logic
- `stupid training.mp4` – sample video (tracked with Git LFS)

## Notes
- Large media tracked with **Git LFS** (GitHub’s 100 MB limit).
