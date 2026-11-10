from collections import Counter
from io import BytesIO
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSET_DIR = ROOT / "assets" / "questions"
SOURCES = [
    ("kresz2", "kinai kresz 2.docx", "KRESZ 2"),
    ("test2", "Kinai teszt 2.docx", "Test 2"),
    ("test3", "kínai teszt 3.docx", "Test 3"),
    ("test4", "kinai teszt 4.docx", "Test 4"),
    ("test5", "kinai teszt5.docx", "Test 5"),
]
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
SCORE_RE = re.compile(r"^\(\s*(\d+)(?:\s*分\s*\)(?:\d+)?)?$")
CORRECT_RE = re.compile(r"5\s*[。.]?(?:\s+[A-Za-zÀ-ž][^\n]*)?$")


def clean_text(value):
    return " ".join(value.split())


def clean_option(value):
    value = CORRECT_RE.sub("", value).strip()
    value = re.sub(r"\s+v$", "", value).strip()
    return clean_text(value)


def normalized(value):
    return re.sub(r"[\s。！？!?]", "", value)


def parse_document(slug, filename, label):
    path = ROOT / filename
    with ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
        relationships = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
        rels = {rel.get("Id"): rel.get("Target") for rel in relationships}
        paragraphs = []
        for paragraph in document.iter(W + "p"):
            text = "".join(node.text or "" for node in paragraph.iter(W + "t")).strip()
            refs = [
                node.get(R + "embed") or node.get(R + "id")
                for node in paragraph.iter()
                if node.tag.endswith("}blip") or node.tag.endswith("}imagedata")
            ]
            paragraphs.append({"text": text, "images": [rels.get(ref, ref) for ref in refs]})

        scores = [(i, SCORE_RE.match(p["text"])) for i, p in enumerate(paragraphs) if SCORE_RE.match(p["text"])]
        questions = []
        for index, (score_index, match) in enumerate(scores):
            question_index = score_index - 1
            while question_index >= 0 and not paragraphs[question_index]["text"]:
                question_index -= 1
            if index + 1 < len(scores):
                end = scores[index + 1][0] - 1
                while end > score_index and not paragraphs[end]["text"]:
                    end -= 1
            else:
                end = len(paragraphs)
            options = [clean_text(p["text"]) for p in paragraphs[score_index + 1:end] if p["text"]]
            footer = next((i for i, option in enumerate(options) if option == "剩余的时间："), None)
            if footer is not None:
                options = options[:footer]
            correct = [i for i, option in enumerate(options) if CORRECT_RE.search(option)]
            questions.append({
                "id": f"{slug}-q{index + 1:03d}",
                "source": label,
                "sourceQuestion": index + 1,
                "text": clean_text(paragraphs[question_index]["text"]),
                "points": int(match.group(1)),
                "rawOptions": options,
                "correct": correct,
                "images": [],
            })

    if slug == "test5":
        for index, question in enumerate(questions):
            if question["text"].startswith("无论车辆是否安装有安全气当司机的体内有酒精时"):
                previous = questions[index - 1]
                previous["rawOptions"].append("无论车辆是否安装有安全气囊，都必须系上安全带。5")
                previous["correct"] = [2]
                question["text"] = "当司机的体内有酒精时，反应时间会如何变化？"
                question["rawOptions"] = question["rawOptions"][:3]
                question["correct"] = [0]

    return questions


def recover_missing_answers(questions):
    keyed = {}
    for question in questions:
        if len(question["correct"]) == 1:
            keyed.setdefault(normalized(question["text"]), []).append(question)
    for question in questions:
        if question["correct"]:
            continue
        donors = keyed.get(normalized(question["text"]), [])
        recovered = False
        for donor in donors:
            answer = clean_option(donor["rawOptions"][donor["correct"][0]])
            match = next((i for i, option in enumerate(question["rawOptions"]) if normalized(clean_option(option)) == normalized(answer)), None)
            if match is not None:
                question["correct"] = [match]
                recovered = True
                break
        if not recovered and donors:
            donor = donors[0]
            question["rawOptions"] = list(donor["rawOptions"])
            question["correct"] = list(donor["correct"])
            recovered = True
        if not recovered:
            raise ValueError(f"No answer key available for {question['id']}: {question['text']}")


def apply_screenshot_questions(questions):
    groups = json.loads((ROOT / "tools" / "screenshot_questions.json").read_text(encoding="utf-8"))
    by_id = {question["id"]: question for question in questions}
    source_paths = {slug: ROOT / filename for slug, filename, _ in SOURCES}
    archives = {slug: ZipFile(path) for slug, path in source_paths.items()}
    used = set()
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    try:
        for group in groups:
            paths = []
            for reference in group["images"]:
                slug = reference["slug"]
                number = reference["image"]
                key = (slug, number)
                if key in used:
                    raise ValueError(f"Duplicate screenshot assignment: {key}")
                used.add(key)
                output_name = f"{slug}-image{number}.png"
                output_path = ASSET_DIR / output_name
                source_image = Image.open(BytesIO(archives[slug].read(f"word/media/image{number}.png"))).convert("RGB")
                source_image.crop((835, 340, 1285, 730)).save(output_path, optimize=True)
                paths.append(f"assets/questions/{output_name}")
            if "questionId" in group:
                by_id[group["questionId"]]["images"].extend(paths)
            else:
                new = group["newQuestion"]
                questions.append({
                    "id": group["id"],
                    "source": new["source"],
                    "sourceQuestion": new["sourceQuestion"],
                    "text": new["text"],
                    "points": new["points"],
                    "rawOptions": new["options"],
                    "correct": [new["correct"]],
                    "images": paths,
                })
    finally:
        for archive in archives.values():
            archive.close()
    if len(used) != 151:
        raise ValueError(f"Expected 151 screenshot assignments, found {len(used)}")


def main():
    questions = []
    for source in SOURCES:
        questions.extend(parse_document(*source))
    recover_missing_answers(questions)
    apply_screenshot_questions(questions)
    question_count = len(questions)
    questions = [
        question
        for question in questions
        if question["images"] or "图" not in question["text"] and "视频" not in question["text"]
    ]
    removed = question_count - len(questions)

    output = []
    for index, question in enumerate(questions):
        if len(question["correct"]) != 1:
            raise ValueError(f"Expected one answer for {question['id']}")
        if not 2 <= len(question["rawOptions"]) <= 4:
            raise ValueError(f"Unexpected option count for {question['id']}")
        output.append({
            "id": question["id"],
            "number": index + 1,
            "source": question["source"],
            "sourceQuestion": question["sourceQuestion"],
            "text": question["text"],
            "points": question["points"],
            "options": [clean_option(option) for option in question["rawOptions"]],
            "correct": question["correct"][0],
            "images": question["images"],
        })

    data = json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "questions.js").write_text(f"window.DRIVING_QUESTIONS={data};\n", encoding="utf-8")
    illustrated = sum(bool(question["images"]) for question in output)
    print(f"Extracted {len(output)} questions ({illustrated} illustrated, {len(list(ASSET_DIR.glob('*.png')))} images)")
    print(f"Removed {removed} media-dependent questions without linked media")
    print("Sources:", dict(Counter(question["source"] for question in output)))
    print("Points:", dict(Counter(question["points"] for question in output)))


if __name__ == "__main__":
    main()
