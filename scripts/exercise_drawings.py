"""Redraw exercise photos as clean illustrations: white background, grey figure, the working muscles in red.

Each listed exercise gets a start and a finish drawing from Gemini (``DRAWING_MODEL`` on Vertex AI, billed to
``mygymbot``, about $0.07 per picture). Each is drawn from its own photo with the same detailed style and the dataset's
description of the movement: with the start drawing as a reference, Gemini kept copying the start pose. The drawings
replace the photos in ``web/exercises/`` (same file names, so the app needs no change), and their ids are added to
``scripts/drawn-exercises.txt``, which ``exercise_photos.py`` leaves alone.

Run: ``uv run python scripts/exercise_drawings.py ID [ID ...]`` (ids from ``src/exercise-photos.js``; the next batch is
the ids there that ``drawn-exercises.txt`` doesn't list yet). Then look at every sheet in ``.drawings/review-*.png``
(each row: start photo, start drawing, finish photo, finish drawing). Typical faults: the finish copies the start pose,
extra gym equipment, the two drawings from different sides. Run again with the ids of bad pairs; after about 3 failed
tries, restore the photos (``git checkout web/exercises/<id>-*.webp``) and remove the id from ``drawn-exercises.txt``.
"""

import json
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import google.auth
from google import genai
from google.genai import types

from exercise_photos import DRAWN_FILE, PHOTO_WIDTH, PHOTOS_DIR, ROOT, WEBP_QUALITY, fetch

GCP_PROJECT = "mygymbot"
DRAWING_MODEL = "gemini-3.1-flash-image"
REVIEW_DIR = ROOT / ".drawings"
PROMPT = (
    "Redraw this photo of the {position} of {name}. Copy the photo exactly: the same camera angle, the same side of the "
    "body facing the camera (if the face shows, draw the front of the body), the same position of every arm, leg and the "
    "head, the hands and the weights exactly where the photo has them, and the same equipment. Clean fitness-app "
    "illustration on a pure white background. The person is a smooth light grey figure with no face details and no "
    "clothes. Only these muscles are red, drawn as anatomical muscle shapes: {muscles}; all other muscles stay grey. "
    "Equipment in dark grey, drawn clearly so it is easy to recognise. Draw only the person and the equipment they are "
    "using: leave out racks, machines, benches and weights they don't touch. No text, no logos, no floor, no shadows. "
    "Square image. How the exercise moves: {instructions} This photo is the {position} of the movement; draw that pose."
)
POSITIONS = ("start", "end")

_local = threading.local()


def client() -> genai.Client:
    """One Vertex AI client per thread (a shared one gets closed under concurrent calls), billed to ``mygymbot``."""
    if not hasattr(_local, "client"):
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"], quota_project_id=GCP_PROJECT
        )
        _local.client = genai.Client(vertexai=True, project=GCP_PROJECT, location="global", credentials=credentials)
    return _local.client


def draw(parts: list[types.Part | str]) -> bytes:
    """One image from Gemini."""
    response = client().models.generate_content(
        model=DRAWING_MODEL, contents=parts, config=types.GenerateContentConfig(response_modalities=["IMAGE"])
    )
    return next(part.inline_data.data for part in response.candidates[0].content.parts if part.inline_data)


def save_webp(image: bytes, exercise_id: str, index: int) -> None:
    """Write the drawing at the app's size, over the photo."""
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", "pipe:0", "-vf", f"scale={PHOTO_WIDTH}:-2",
         "-c:v", "libwebp", "-quality", str(WEBP_QUALITY), str(PHOTOS_DIR / f"{exercise_id}-{index}.webp")],
        input=image, check=True,
    )


def draw_exercise(exercise: dict) -> str | None:
    """Start and finish drawings for one exercise; returns its id, or ``None`` if Gemini failed (the photos stay)."""
    exercise_id = exercise["id"]
    words = {"name": exercise["name"], "muscles": ", ".join(exercise["primaryMuscles"]), "instructions": " ".join(exercise["instructions"])}
    photos = [fetch(f"exercises/{image}") for image in exercise["images"]]
    try:
        drawings = [
            draw([types.Part.from_bytes(data=photo, mime_type="image/jpeg"), PROMPT.format(position=position, **words)])
            for photo, position in zip(photos, POSITIONS)
        ]
    except Exception as error:  # one failure shouldn't lose the exercises already drawn
        print(f"{exercise_id} failed: {error}", flush=True)
        return None
    for index, (photo, drawing) in enumerate(zip(photos, drawings)):
        (REVIEW_DIR / f"{exercise_id}-photo{index}.jpg").write_bytes(photo)
        (REVIEW_DIR / f"{exercise_id}-{index}.png").write_bytes(drawing)
        save_webp(drawing, exercise_id, index)
    print(exercise_id, flush=True)
    return exercise_id


def save_review_sheets(ids: list[str], rows_per_sheet: int = 8) -> None:
    """Contact sheets of photos next to drawings, to check every pair by eye."""
    tile = 240
    for sheet, first in enumerate(range(0, len(ids), rows_per_sheet), start=1):
        files = [
            REVIEW_DIR / name
            for i in ids[first : first + rows_per_sheet]
            for name in (f"{i}-photo0.jpg", f"{i}-0.png", f"{i}-photo1.jpg", f"{i}-1.png")
        ]
        fit = f"scale={tile}:{tile}:force_original_aspect_ratio=decrease,pad={tile}:{tile}:(ow-iw)/2:(oh-ih)/2:white"
        label = lambda n: f",drawtext=text='{files[n].name.removesuffix('-photo0.jpg')}':x=4:y=4:fontsize=14:fontcolor=blue"  # noqa: E731
        tiles = ";".join(f"[{n}]{fit}{label(n) if n % 4 == 0 else ''}[t{n}]" for n in range(len(files)))
        layout = "|".join(f"{n % 4 * tile}_{n // 4 * tile}" for n in range(len(files)))
        graph = f"{tiles};{''.join(f'[t{n}]' for n in range(len(files)))}xstack=inputs={len(files)}:layout={layout}"
        inputs = [arg for file in files for arg in ("-i", str(file))]
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph, str(REVIEW_DIR / f"review-{sheet}.png")],
            check=True,
        )


def main(ids: list[str]) -> None:
    by_id = {e["id"]: e for e in json.loads(fetch("dist/exercises.json"))}
    unknown = [i for i in ids if i not in by_id or not (PHOTOS_DIR / f"{i}-0.webp").exists()]
    if unknown:
        sys.exit(f"Not in web/exercises/: {', '.join(unknown)}")
    REVIEW_DIR.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        drawn = list(pool.map(draw_exercise, (by_id[i] for i in ids)))
    listed = set(DRAWN_FILE.read_text().split()) if DRAWN_FILE.exists() else set()
    drawn = [i for i in drawn if i]
    DRAWN_FILE.write_text("\n".join(sorted(listed | set(drawn))) + "\n")
    for old_sheet in REVIEW_DIR.glob("review-*.png"):
        old_sheet.unlink()
    save_review_sheets(drawn)
    print(f"{len(drawn)} exercises drawn; check {REVIEW_DIR}/review-*.png")


if __name__ == "__main__":
    main(sys.argv[1:])
