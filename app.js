// ==========================================
// GOOGLE APPS SCRIPT API CONFIGURATION
// ==========================================

// API URL dari Google Apps Script Anda
const API_URL = "https://script.google.com/macros/s/AKfycbw3fyl6Ete3aZPFqHsFnYRZUiELg1dfrlFQS-OtsBs37f5M2GE9Bc8Mzo99y4eBUsHB/exec";

let questionsData = [];
let currentQuestionIndex = 0;
let score = 0;

// Ambil elemen HTML
const questionElement = document.getElementById("question-text");
const optionsContainer = document.getElementById("options-container");
const nextBtn = document.getElementById("next-btn");
const nextBtnContainer = document.getElementById("next-btn-container");

// ==========================================
// FUNGSI AMBIL DATA DARI API
// ==========================================

async function fetchQuestions() {
    try {
        // Tampilkan pesan loading
        questionElement.innerText = "Memuat soal...";
        
        const response = await fetch(API_URL);
        
        if (!response.ok) {
            throw new Error("Gagal mengambil data dari server");
        }
        
        // Ambil data dalam bentuk JSON
        const data = await response.json();
        
        console.log("Data dari API:", data);
        
        // Pastikan data berbentuk array
        // Apps Script mungkin mengembalikan objek dengan properti tertentu
        if (Array.isArray(data)) {
            questionsData = data;
        } else if (data.questions) {
            questionsData = data.questions;
        } else if (data.data) {
            questionsData = data.data;
        } else {
            // Konversi objek ke array jika perlu
            questionsData = Object.values(data);
        }
        
        // Mulai tampilkan soal pertama
        if (questionsData.length > 0) {
            showQuestion();
        } else {
            questionElement.innerText = "Tidak ada soal ditemukan!";
        }
        
    } catch (error) {
        console.error("Error:", error);
        questionElement.innerText = "Gagal memuat soal. Periksa koneksi internet Anda!";
    }
}

// ==========================================
// FUNGSI TAMPILKAN SOAL
// ==========================================

function showQuestion() {
    // Reset container opsi
    optionsContainer.innerHTML = "";
    
    // Ambil data soal berdasarkan index
    const currentData = questionsData[currentQuestionIndex];
    
    // Tampilkan teks soal
    // Support berbagai format nama properti
    const questionText = currentData.question || currentData.Question || currentData.soal || currentData.Soal;
    questionElement.innerText = `${currentQuestionIndex + 1}. ${questionText}`;
    
    // Ambil opsi - support berbagai format nama properti
    let options = [];
    if (Array.isArray(currentData.options)) {
        options = currentData.options;
    } else if (currentData.options) {
        options = Object.values(currentData.options);
    } else {
        // Coba ambil dari properti lain
        options = [
            currentData.option1 || currentData.Option1 || currentData.a,
            currentData.option2 || currentData.Option2 || currentData.b,
            currentData.option3 || currentData.Option3 || currentData.c
        ].filter(Boolean);
    }
    
    // Ambil jawaban benar
    const correctAnswer = currentData.answer || currentData.Answer || currentData.jawaban || currentData.correct;
    
    // Acak posisi opsi
    const shuffledOptions = [...options].sort(() => Math.random() - 0.5);
    
    // Buat tombol untuk setiap opsi
    shuffledOptions.forEach(option => {
        const button = document.createElement("button");
        button.innerText = option;
        button.classList.add("option-btn");
        
        // Event klik untuk memilih jawaban
        button.addEventListener("click", () => checkAnswer(button, correctAnswer, options));
        
        optionsContainer.appendChild(button);
    });
}

// ==========================================
// FUNGSI CEK JAWABAN
// ==========================================

function checkAnswer(selectedButton, correctAnswer, allOptions) {
    const selectedText = selectedButton.innerText;
    
    // Cari jawaban benar dari opsi asli (yang tidak diacak)
    const actualCorrectAnswer = allOptions.find(opt => opt === correctAnswer) || correctAnswer;
    
    // Cek apakah jawaban benar
    if (selectedText === actualCorrectAnswer) {
        score++;
        selectedButton.style.backgroundColor = "#4CAF50"; // Hijau (Benar)
    } else {
        selectedButton.style.backgroundColor = "#f44336"; // Merah (Salah)
        
        // Tunjukkan jawaban yang benar
        const allButtons = optionsContainer.querySelectorAll("button");
        allButtons.forEach(btn => {
            if (btn.innerText === actualCorrectAnswer) {
                btn.style.backgroundColor = "#4CAF50";
            }
        });
    }
    
    // Nonaktifkan semua tombol
    const allButtons = optionsContainer.querySelectorAll("button");
    allButtons.forEach(btn => btn.disabled = true);
    
    // Tampilkan tombol Next
    nextBtnContainer.style.display = "block";
    nextBtn.onclick = nextQuestion;
}

// ==========================================
// FUNGSI NEXT QUESTION
// ==========================================

function nextQuestion() {
    currentQuestionIndex++;
    
    if (currentQuestionIndex < questionsData.length) {
        nextBtnContainer.style.display = "none";
        showQuestion();
    } else {
        finishQuiz();
    }
}

// ==========================================
// FUNGSI AKHIR KUIS
// ==========================================

function finishQuiz() {
    questionElement.innerText = `Kuis Selesai! Skor Anda: ${score} / ${questionsData.length}`;
    optionsContainer.innerHTML = "";
    nextBtnContainer.style.display = "none";
    
    // Tombol Restart
    const restartBtn = document.createElement("button");
    restartBtn.innerText = "Mulai Ulang";
    restartBtn.classList.add("option-btn");
    restartBtn.onclick = () => location.reload();
    optionsContainer.appendChild(restartBtn);
}

// ==========================================
// MULAI APLIKASI
// ==========================================

// Panggil fungsi untuk ambil data saat halaman dimuat
fetchQuestions();