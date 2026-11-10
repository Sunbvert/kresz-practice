(() => {
  "use strict";

  const questions = window.DRIVING_QUESTIONS || [];
  const STORAGE_KEY = "kresz-practice-progress-v1";
  const EXAM_DURATION_SECONDS = 55 * 60;
  const EXAM_COMPOSITION = [{ points: 1, count: 45 }, { points: 3, count: 10 }];
  const questionById = new Map(questions.map((question, index) => [question.id, { question, index }]));
  const $ = id => document.getElementById(id);
  const elements = {
    answeredCount: $("answeredCount"), answeredTotal: $("answeredTotal"), correctCount: $("correctCount"),
    correctRate: $("correctRate"), wrongCount: $("wrongCount"), wrongButtonCount: $("wrongButtonCount"),
    progressPercent: $("progressPercent"), progressRing: $("progressRing"), mapSummary: $("mapSummary"),
    questionMap: $("questionMap"), sourceTag: $("sourceTag"), pointsTag: $("pointsTag"), reviewTag: $("reviewTag"),
    questionPosition: $("questionPosition"), questionProgressBar: $("questionProgressBar"),
    questionBody: $("questionBody"), questionText: $("questionText"), questionGallery: $("questionGallery"),
    optionsList: $("optionsList"), answerFeedback: $("answerFeedback"), answerForm: $("answerForm"),
    autoAdvanceCheckbox: $("autoAdvanceCheckbox"), submitButton: $("submitButton"), previousButton: $("previousButton"), nextButton: $("nextButton"),
    quizFooter: $("quizFooter"), emptyState: $("emptyState"), reviewWrongButton: $("reviewWrongButton"),
    questionsModal: $("questionsModal"), questionList: $("questionList"), listEmpty: $("listEmpty"),
    questionSearch: $("questionSearch"), toggleMapButton: $("toggleMapButton"), toast: $("toast"),
    mockTestButton: $("mockTestButton"), examTimer: $("examTimer"), examTimerText: $("examTimerText"),
    finishExamButton: $("finishExamButton"), examResults: $("examResults"), examResultBadge: $("examResultBadge"),
    examResultTitle: $("examResultTitle"), examScore: $("examScore"), examCorrectCount: $("examCorrectCount"),
    examWrongCount: $("examWrongCount"), examUnansweredCount: $("examUnansweredCount")
  };

  let state = loadState();
  elements.autoAdvanceCheckbox.checked = state.autoAdvance;
  let selectedOption = currentAnswer()?.selected ?? null;
  let activeFilter = "all";
  let advanceTimer = null;
  let toastTimer = null;
  let isAdvancing = false;
  let lastFocusedElement = null;
  let clockTimer = null;

  function freshState() {
    return { answers: {}, current: 0, mode: "all", exam: null, autoAdvance: false };
  }

  function loadState() {
    const fallback = freshState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return fallback;
      for (const [id, answer] of Object.entries(saved.answers || {})) {
        const entry = questionById.get(id);
        if (entry && Number.isInteger(answer.selected) && answer.selected >= 0 && answer.selected < entry.question.options.length) {
          fallback.answers[id] = { selected: answer.selected };
        }
      }
      fallback.autoAdvance = Boolean(saved.autoAdvance);
      fallback.current = Number.isInteger(saved.current) ? Math.max(0, Math.min(saved.current, questions.length - 1)) : 0;
      fallback.exam = sanitizeExam(saved.exam);
      fallback.mode = saved.mode === "wrong" || saved.mode === "mock" && fallback.exam ? saved.mode : "all";
      if (fallback.mode === "wrong") {
        const savedWrong = question => {
          const answer = fallback.answers[question.id];
          return Boolean(answer) && answer.selected !== question.correct;
        };
        const wrong = questions.filter(savedWrong);
        if (!wrong.length) fallback.mode = "all";
        else if (!savedWrong(questions[fallback.current])) fallback.current = wrong[0].number - 1;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  function sanitizeExam(exam) {
    if (!exam || !Array.isArray(exam.ids) || exam.ids.length !== 55 || new Set(exam.ids).size !== 55 || !Number.isFinite(exam.startedAt)) return null;
    const examQuestions = exam.ids.map(id => questionById.get(id)?.question);
    if (examQuestions.some(question => !question)) return null;
    if (examQuestions.filter(question => question.points === 1).length !== 45 || examQuestions.filter(question => question.points === 3).length !== 10) return null;
    const clean = {
      ids: exam.ids,
      current: Number.isInteger(exam.current) ? Math.max(0, Math.min(exam.current, 54)) : 0,
      startedAt: exam.startedAt,
      answers: {},
      finished: Boolean(exam.finished),
      finishedAt: Number.isFinite(exam.finishedAt) ? exam.finishedAt : null,
      showResults: exam.showResults !== false
    };
    for (const [id, answer] of Object.entries(exam.answers || {})) {
      const question = questionById.get(id)?.question;
      if (exam.ids.includes(id) && Number.isInteger(answer.selected) && answer.selected >= 0 && answer.selected < question.options.length) {
        clean.answers[id] = { selected: answer.selected };
      }
    }
    if (!clean.finished && Date.now() >= clean.startedAt + EXAM_DURATION_SECONDS * 1000) {
      clean.finished = true;
      clean.finishedAt = clean.startedAt + EXAM_DURATION_SECONDS * 1000;
      clean.showResults = true;
    }
    return clean;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      showToast("Progress could not be saved in this browser.");
    }
  }

  function examQuestions() {
    return state.exam ? state.exam.ids.map(id => questionById.get(id).question) : [];
  }

  function currentQuestion() {
    return state.mode === "mock" && state.exam ? examQuestions()[state.exam.current] : questions[state.current];
  }

  function answerFor(question) {
    return state.mode === "mock" && state.exam ? state.exam.answers[question.id] : state.answers[question.id];
  }

  function currentAnswer() {
    const question = currentQuestion();
    return question ? answerFor(question) : null;
  }

  function isCorrect(question, answers = state.answers) {
    return answers[question.id]?.selected === question.correct;
  }

  function isWrong(question, answers = state.answers) {
    const answer = answers[question.id];
    return Boolean(answer) && answer.selected !== question.correct;
  }

  function wrongQuestions() {
    return questions.filter(question => isWrong(question));
  }

  function sequence() {
    if (state.mode === "mock") return examQuestions();
    return state.mode === "wrong" ? wrongQuestions() : questions;
  }

  function counts() {
    const answered = Object.keys(state.answers).length;
    const correct = questions.filter(question => isCorrect(question)).length;
    return { answered, correct, wrong: answered - correct };
  }

  function renderStats() {
    const result = counts();
    const percent = questions.length ? Math.round(result.answered / questions.length * 100) : 0;
    elements.answeredCount.textContent = result.answered;
    elements.answeredTotal.textContent = `of ${questions.length}`;
    elements.correctCount.textContent = result.correct;
    elements.correctRate.textContent = result.answered ? `${Math.round(result.correct / result.answered * 100)}% correct` : "—";
    elements.wrongCount.textContent = result.wrong;
    elements.wrongButtonCount.textContent = result.wrong;
    elements.progressPercent.textContent = `${percent}%`;
    elements.progressRing.style.strokeDashoffset = String(119.38 * (1 - percent / 100));
    elements.reviewWrongButton.disabled = result.wrong === 0;
    elements.mockTestButton.querySelector("span").textContent = state.exam ? state.exam.finished ? "View result" : "Resume test" : "Mock test";
    $("filterAllCount").textContent = questions.length;
    $("filterCorrectCount").textContent = result.correct;
    $("filterWrongCount").textContent = result.wrong;
    $("filterUnansweredCount").textContent = questions.length - result.answered;
  }

  function renderMap() {
    const mock = state.mode === "mock" && state.exam;
    const mapQuestions = mock ? examQuestions() : questions;
    const answers = mock ? state.exam.answers : state.answers;
    const currentIndex = mock ? state.exam.current : state.current;
    $("mapTitle").textContent = mock ? "Mock test map" : "Question map";
    const answered = Object.keys(answers).length;
    elements.mapSummary.textContent = mock ? `${answered} of 55 answered` : `${counts().answered} of ${questions.length} answered`;
    const fragment = document.createDocumentFragment();
    for (const [index, question] of mapQuestions.entries()) {
      const button = document.createElement("button");
      const answer = answers[question.id];
      const status = !answer ? "unanswered" : isCorrect(question, answers) ? "correct" : "wrong";
      button.type = "button";
      button.className = `map-box ${status}`;
      button.textContent = index + 1;
      button.title = `Question ${index + 1}: ${status} · ${question.points} point${question.points === 1 ? "" : "s"}`;
      button.setAttribute("aria-label", `Go to question ${index + 1}, ${status}`);
      if (index === currentIndex) {
        button.classList.add("current");
        button.setAttribute("aria-current", "true");
      }
      button.addEventListener("click", () => mock ? navigateExam(index) : navigateTo(index, "all"));
      fragment.appendChild(button);
    }
    elements.questionMap.replaceChildren(fragment);
    requestAnimationFrame(() => {
      const current = elements.questionMap.querySelector(".current");
      if (!current) return;
      const mapRect = elements.questionMap.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      if (currentRect.top < mapRect.top || currentRect.bottom > mapRect.bottom) {
        elements.questionMap.scrollTop += currentRect.top - mapRect.top - elements.questionMap.clientHeight / 2;
      }
    });
  }

  function renderQuestion() {
    const wrong = wrongQuestions();
    const mock = state.mode === "mock" && state.exam;
    const emptyReview = state.mode === "wrong" && wrong.length === 0;
    const showResults = mock && state.exam.finished && state.exam.showResults;
    elements.emptyState.hidden = !emptyReview;
    elements.examResults.hidden = !showResults;
    elements.questionBody.hidden = emptyReview || showResults;
    elements.quizFooter.hidden = emptyReview || showResults;
    elements.reviewTag.hidden = state.mode !== "wrong" && !mock;
    elements.reviewTag.textContent = mock ? "Mock test" : "Wrong-answer review";
    elements.examTimer.hidden = !mock;
    elements.finishExamButton.hidden = !mock || state.exam.finished;
    if (mock) updateTimer();
    if (showResults) {
      elements.sourceTag.textContent = "55 questions · 75 points";
      elements.pointsTag.hidden = true;
      elements.questionPosition.textContent = "Test completed";
      elements.questionProgressBar.style.width = "100%";
      renderExamResults();
      return;
    }
    if (emptyReview) {
      elements.sourceTag.textContent = "Review complete";
      elements.pointsTag.hidden = true;
      elements.questionPosition.textContent = "All wrong answers corrected";
      elements.questionProgressBar.style.width = "100%";
      return;
    }

    const question = currentQuestion();
    if (!question) return;
    const answer = answerFor(question);
    const reviewAttempt = state.mode === "wrong" && isWrong(question) && !isAdvancing;
    const displayedAnswer = reviewAttempt ? null : answer;
    const activeSequence = sequence();
    const sequenceIndex = activeSequence.findIndex(item => item.id === question.id);
    elements.sourceTag.textContent = `${question.source} · #${question.sourceQuestion}`;
    elements.pointsTag.hidden = false;
    elements.pointsTag.textContent = `${question.points} point${question.points === 1 ? "" : "s"}`;
    elements.questionPosition.textContent = state.mode === "wrong"
      ? `${wrong.length} wrong answer${wrong.length === 1 ? "" : "s"} remaining`
      : mock ? `Question ${state.exam.current + 1} of 55` : `Question ${question.number} of ${questions.length}`;
    const progress = state.mode === "wrong" || mock
      ? (sequenceIndex + 1) / Math.max(activeSequence.length, 1) * 100
      : question.number / questions.length * 100;
    elements.questionProgressBar.style.width = `${progress}%`;
    elements.questionText.textContent = question.text;
    renderGallery(question);
    renderOptions(question, displayedAnswer);
    renderFeedback(question, displayedAnswer);

    elements.submitButton.disabled = (!selectedOption && selectedOption !== 0) || (Boolean(answer) && !reviewAttempt) || isAdvancing;
    elements.submitButton.innerHTML = displayedAnswer ? "Answered" : "Submit answer <span aria-hidden=\"true\">→</span>";
    elements.previousButton.disabled = isAdvancing || sequenceIndex <= 0;
    elements.nextButton.disabled = isAdvancing || sequenceIndex < 0 || sequenceIndex >= activeSequence.length - 1;
  }

  function renderGallery(question) {
    elements.questionGallery.replaceChildren();
    elements.questionGallery.hidden = question.images.length === 0;
    elements.questionGallery.classList.toggle("multiple", question.images.length > 1);
    for (const [index, source] of question.images.entries()) {
      const image = document.createElement("img");
      image.src = source;
      image.alt = `Illustration ${index + 1} for question ${question.number}`;
      image.loading = "lazy";
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", "Enlarge question illustration");
      image.addEventListener("click", () => openImage(source, image.alt));
      image.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openImage(source, image.alt);
        }
      });
      elements.questionGallery.appendChild(image);
    }
  }

  function renderOptions(question, answer) {
    const fragment = document.createDocumentFragment();
    question.options.forEach((option, index) => {
      const button = document.createElement("button");
      const letter = String.fromCharCode(65 + index);
      button.type = "button";
      button.className = "option";
      button.disabled = Boolean(answer) || isAdvancing;
      button.setAttribute("aria-pressed", String(selectedOption === index));
      if (!answer && selectedOption === index) button.classList.add("selected");
      if (answer && index === question.correct) button.classList.add("correct");
      if (answer && index === answer.selected && index !== question.correct) button.classList.add("wrong");

      const letterSpan = document.createElement("span");
      letterSpan.className = "option-letter";
      letterSpan.textContent = letter;
      const textSpan = document.createElement("span");
      textSpan.textContent = option;
      button.append(letterSpan, textSpan);
      if (answer && index === question.correct) {
        const result = document.createElement("span");
        result.className = "option-result";
        result.textContent = "✓";
        result.setAttribute("aria-label", "Correct answer");
        button.appendChild(result);
      } else if (answer && index === answer.selected) {
        const result = document.createElement("span");
        result.className = "option-result";
        result.textContent = "×";
        result.setAttribute("aria-label", "Your wrong answer");
        button.appendChild(result);
      }
      button.addEventListener("click", () => {
        const reviewAttempt = state.mode === "wrong" && isWrong(question);
        if ((answerFor(question) && !reviewAttempt) || isAdvancing) return;
        selectedOption = index;
        renderOptions(question, null);
        elements.submitButton.disabled = false;
        if (state.autoAdvance) elements.answerForm.requestSubmit();
      });
      fragment.appendChild(button);
    });
    elements.optionsList.replaceChildren(fragment);
  }

  function renderFeedback(question, answer) {
    elements.answerFeedback.hidden = !answer;
    if (!answer) return;
    const correct = answer.selected === question.correct;
    elements.answerFeedback.className = `answer-feedback ${correct ? "correct" : "wrong"}`;
    if (correct) {
      elements.answerFeedback.textContent = isAdvancing ? "Correct. Moving to the next question…" : "Correct.";
    } else {
      const letter = String.fromCharCode(65 + question.correct);
      elements.answerFeedback.textContent = `Not quite. Correct answer: ${letter}. ${question.options[question.correct]}`;
    }
  }

  function renderList() {
    const search = elements.questionSearch.value.trim().toLocaleLowerCase();
    const filtered = questions.filter(question => {
      const answer = state.answers[question.id];
      const matchesFilter = activeFilter === "all"
        || activeFilter === "correct" && isCorrect(question)
        || activeFilter === "wrong" && isWrong(question)
        || activeFilter === "unanswered" && !answer;
      return matchesFilter && (!search || question.text.toLocaleLowerCase().includes(search));
    });
    const fragment = document.createDocumentFragment();
    for (const question of filtered) {
      const answer = state.answers[question.id];
      const status = !answer ? "unanswered" : isCorrect(question) ? "correct" : "wrong";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `list-question ${status}`;
      const number = document.createElement("span");
      number.className = "list-number";
      number.textContent = question.number;
      const copy = document.createElement("span");
      copy.className = "list-copy";
      const title = document.createElement("strong");
      title.textContent = question.text;
      const detail = document.createElement("small");
      if (answer) {
        const selectedLetter = String.fromCharCode(65 + answer.selected);
        detail.textContent = `Your answer: ${selectedLetter}. ${question.options[answer.selected]}`;
        if (status === "wrong") {
          const correctLetter = String.fromCharCode(65 + question.correct);
          detail.textContent += ` · Correct: ${correctLetter}. ${question.options[question.correct]}`;
        }
      } else {
        detail.textContent = `${question.source} · ${question.points} point${question.points === 1 ? "" : "s"}`;
      }
      copy.append(title, detail);
      const statusLabel = document.createElement("span");
      statusLabel.className = "list-status";
      statusLabel.textContent = status[0].toUpperCase() + status.slice(1);
      button.append(number, copy, statusLabel);
      button.addEventListener("click", () => {
        closeModal();
        navigateTo(question.number - 1, "all");
      });
      fragment.appendChild(button);
    }
    elements.questionList.replaceChildren(fragment);
    elements.listEmpty.hidden = filtered.length > 0;
  }

  function renderAll() {
    renderStats();
    renderMap();
    renderQuestion();
    if (!elements.questionsModal.hidden) renderList();
  }

  function cancelAdvance() {
    clearTimeout(advanceTimer);
    advanceTimer = null;
    isAdvancing = false;
  }

  function navigateTo(index, mode = state.mode) {
    if (!questions.length) return;
    cancelAdvance();
    state.current = Math.max(0, Math.min(index, questions.length - 1));
    state.mode = mode;
    selectedOption = currentAnswer()?.selected ?? null;
    saveState();
    renderAll();
  }

  function navigateExam(index) {
    if (!state.exam) return;
    cancelAdvance();
    state.mode = "mock";
    state.exam.current = Math.max(0, Math.min(index, 54));
    state.exam.showResults = false;
    selectedOption = currentAnswer()?.selected ?? null;
    saveState();
    renderAll();
  }

  function move(delta) {
    const activeSequence = sequence();
    const index = activeSequence.findIndex(question => question.id === currentQuestion().id);
    const target = activeSequence[index + delta];
    if (!target) return;
    if (state.mode === "mock") navigateExam(index + delta);
    else navigateTo(target.number - 1);
  }

  function submitAnswer(event) {
    event.preventDefault();
    const question = currentQuestion();
    const reviewAttempt = question && state.mode === "wrong" && isWrong(question);
    if (!question || (answerFor(question) && !reviewAttempt) || selectedOption === null || isAdvancing) return;
    if (state.mode === "mock" && state.exam) state.exam.answers[question.id] = { selected: selectedOption };
    state.answers[question.id] = { selected: selectedOption };
    isAdvancing = true;
    saveState();
    renderAll();
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      isAdvancing = false;
      if (state.mode === "mock" && state.exam) {
        if (Object.keys(state.exam.answers).length === 55) {
          finishExam();
          return;
        }
        if (state.exam.current < 54) state.exam.current += 1;
      } else if (state.mode === "all") {
        if (state.current < questions.length - 1) state.current += 1;
      } else {
        const wrong = wrongQuestions();
        if (wrong.length) {
          const next = wrong.find(item => item.number > question.number) || wrong[0];
          state.current = next.number - 1;
        }
      }
      selectedOption = currentAnswer()?.selected ?? null;
      saveState();
      renderAll();
    }, state.autoAdvance ? 0 : 700);
  }

  function shuffle(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const random = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[random]] = [shuffled[random], shuffled[index]];
    }
    return shuffled;
  }

  function createMockTest() {
    const ids = [];
    for (const { points, count } of EXAM_COMPOSITION) {
      const pool = questions.filter(question => question.points === points);
      const unanswered = shuffle(pool.filter(question => !state.answers[question.id]));
      const answered = shuffle(pool.filter(question => state.answers[question.id]));
      ids.push(...[...unanswered, ...answered].slice(0, count).map(question => question.id));
    }
    state.exam = {
      ids: shuffle(ids), current: 0, startedAt: Date.now(), answers: {},
      finished: false, finishedAt: null, showResults: false
    };
    state.mode = "mock";
    selectedOption = null;
    saveState();
    renderAll();
  }

  function openMockTest() {
    if (!state.exam) {
      createMockTest();
      return;
    }
    cancelAdvance();
    state.mode = "mock";
    state.exam.showResults = state.exam.finished;
    selectedOption = currentAnswer()?.selected ?? null;
    saveState();
    renderAll();
  }

  function examResult() {
    const items = examQuestions();
    const correct = items.filter(question => isCorrect(question, state.exam.answers));
    const answered = Object.keys(state.exam.answers).length;
    return {
      score: correct.reduce((score, question) => score + question.points, 0),
      correct: correct.length,
      wrong: answered - correct.length,
      unanswered: 55 - answered
    };
  }

  function renderExamResults() {
    const result = examResult();
    const passed = result.score >= 65;
    elements.examResultBadge.textContent = passed ? "Passed" : "Not passed";
    elements.examResultBadge.classList.toggle("failed", !passed);
    elements.examResultTitle.textContent = passed ? "Congratulations, you passed." : "Keep practising and try again.";
    elements.examScore.textContent = result.score;
    elements.examCorrectCount.textContent = result.correct;
    elements.examWrongCount.textContent = result.wrong;
    elements.examUnansweredCount.textContent = result.unanswered;
  }

  function requestFinishExam() {
    if (!state.exam || state.exam.finished) return;
    const unanswered = 55 - Object.keys(state.exam.answers).length;
    if (unanswered && !window.confirm(`Finish the test with ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}? Unanswered questions score zero.`)) return;
    finishExam();
  }

  function finishExam() {
    if (!state.exam || state.exam.finished) return;
    cancelAdvance();
    state.exam.finished = true;
    state.exam.finishedAt = Date.now();
    state.exam.showResults = true;
    saveState();
    renderAll();
  }

  function updateTimer() {
    if (!state.exam) return;
    if (state.exam.finished) {
      elements.examTimerText.textContent = "Completed";
      elements.examTimer.classList.remove("warning");
      return;
    }
    const deadline = state.exam.startedAt + EXAM_DURATION_SECONDS * 1000;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, "0");
    elements.examTimerText.textContent = `${minutes}:${seconds}`;
    elements.examTimer.classList.toggle("warning", remaining <= 300);
    if (remaining === 0) finishExam();
  }

  function reviewWrong() {
    const wrong = wrongQuestions();
    if (!wrong.length) {
      showToast("There are no wrong answers to review.");
      return;
    }
    navigateTo(wrong[0].number - 1, "wrong");
  }

  function openModal() {
    lastFocusedElement = document.activeElement;
    elements.questionsModal.hidden = false;
    document.body.style.overflow = "hidden";
    renderList();
    $("closeModalButton").focus();
  }

  function closeModal() {
    elements.questionsModal.hidden = true;
    document.body.style.overflow = "";
    lastFocusedElement?.focus();
  }

  function openImage(source, alt) {
    const viewer = document.createElement("div");
    viewer.className = "image-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-label", "Enlarged question illustration");
    const image = document.createElement("img");
    image.src = source;
    image.alt = alt;
    viewer.appendChild(image);
    viewer.addEventListener("click", () => viewer.remove());
    document.body.appendChild(viewer);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2800);
  }

  function resetProgress() {
    if (!window.confirm("Reset all answered questions and start over? This cannot be undone.")) return;
    cancelAdvance();
    state = freshState();
    selectedOption = null;
    elements.autoAdvanceCheckbox.checked = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch { showToast("Browser storage is unavailable."); }
    activeFilter = "all";
    elements.questionSearch.value = "";
    document.querySelectorAll(".filter-tab").forEach(button => {
      const active = button.dataset.filter === "all";
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderAll();
    showToast("All progress has been reset.");
  }

  elements.answerForm.addEventListener("submit", submitAnswer);
  elements.autoAdvanceCheckbox.addEventListener("change", () => {
    state.autoAdvance = elements.autoAdvanceCheckbox.checked;
    saveState();
  });
  elements.previousButton.addEventListener("click", () => move(-1));
  elements.nextButton.addEventListener("click", () => move(1));
  elements.reviewWrongButton.addEventListener("click", reviewWrong);
  elements.mockTestButton.addEventListener("click", openMockTest);
  elements.finishExamButton.addEventListener("click", requestFinishExam);
  $("newMockTestButton").addEventListener("click", createMockTest);
  $("reviewExamAnswersButton").addEventListener("click", () => {
    state.exam.showResults = false;
    selectedOption = currentAnswer()?.selected ?? null;
    saveState();
    renderAll();
  });
  $("backToPracticeButton").addEventListener("click", () => navigateTo(state.current, "all"));
  $("backToAllButton").addEventListener("click", () => navigateTo(state.current, "all"));
  $("viewAllButton").addEventListener("click", openModal);
  $("closeModalButton").addEventListener("click", closeModal);
  document.querySelector("[data-close-modal]").addEventListener("click", closeModal);
  $("resetButton").addEventListener("click", resetProgress);
  $("brandLink").addEventListener("click", event => {
    event.preventDefault();
    navigateTo(state.current, "all");
  });
  elements.questionSearch.addEventListener("input", renderList);
  document.querySelectorAll(".filter-tab").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll(".filter-tab").forEach(tab => {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-pressed", String(active));
      });
      renderList();
    });
  });
  elements.toggleMapButton.addEventListener("click", () => {
    const collapsed = elements.toggleMapButton.getAttribute("aria-expanded") === "false";
    elements.toggleMapButton.setAttribute("aria-expanded", String(collapsed));
    elements.toggleMapButton.setAttribute("aria-label", collapsed ? "Collapse question map" : "Expand question map");
    elements.questionMap.hidden = !collapsed;
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const viewer = document.querySelector(".image-viewer");
    if (viewer) viewer.remove();
    else if (!elements.questionsModal.hidden) closeModal();
  });

  if (!questions.length) {
    elements.questionText.textContent = "The question bank could not be loaded.";
    elements.submitButton.disabled = true;
  } else {
    $("bankSubtitle").textContent = `${questions.length} Chinese practice questions. Your progress is saved on this device.`;
    saveState();
    renderAll();
    clockTimer = setInterval(updateTimer, 1000);
  }
})();
