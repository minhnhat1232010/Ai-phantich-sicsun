// Import necessary modules
const express = require('express');
const fetch = require('node-fetch');
const { LogisticRegression } = require('ml-logistic-regression');
const app = express();

// --- Configuration ---
const HOST = '0.0.0.0';
const PORT = process.env.PORT || 5000;
const SOURCE_URL = "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";

// --- Helper Functions ---
function getTaiXiu(score) {
    return score >= 11 ? "Tài" : "Xỉu";
}

function analyzeHistoricalData(data) {
    const results = data.data.resultList || [];
    const scores = results.map(result => result.score);
    const facesList = results.map(result => result.facesList);
    const bonusCounts = results.map(result => result.lastBonusCount || 0);

    const scoreCounts = scores.reduce((acc, score) => {
        acc[score] = (acc[score] || 0) + 1;
        return acc;
    }, {});
    const totalGames = scores.length;
    const taiCount = scores.filter(score => score >= 11).length;
    const xiuCount = totalGames - taiCount;

    const transitions = { "Tài->Tài": 0, "Tài->Xỉu": 0, "Xỉu->Tài": 0, "Xỉu->Xỉu": 0 };
    for (let i = 1; i < scores.length; i++) {
        const prev = getTaiXiu(scores[i - 1]);
        const curr = getTaiXiu(scores[i]);
        transitions[`${prev}->${curr}`]++;
    }

    const transitionProbs = {
        "Tài->Tài": transitions["Tài->Tài"] / (transitions["Tài->Tài"] + transitions["Tài->Xỉu"] || 1),
        "Tài->Xỉu": transitions["Tài->Xỉu"] / (transitions["Tài->Tài"] + transitions["Tài->Xỉu"] || 1),
        "Xỉu->Tài": transitions["Xỉu->Tài"] / (transitions["Xỉu->Tài"] + transitions["Xỉu->Xỉu"] || 1),
        "Xỉu->Xỉu": transitions["Xỉu->Xỉu"] / (transitions["Xỉu->Tài"] + transitions["Xỉu->Xỉu"] || 1),
    };

    const allFaces = [].concat(...facesList);
    const diceFrequencies = allFaces.reduce((acc, face) => {
        acc[face] = (acc[face] || 0) + 1;
        return acc;
    }, {});
    const diceProbs = {};
    for (let i = 1; i <= 6; i++) {
        diceProbs[i] = (diceFrequencies[i] || 0) / (totalGames * 3);
    }

    const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 10.5;
    const stdScore = scores.length > 0 ? Math.sqrt(scores.map(s => Math.pow(s - meanScore, 2)).reduce((a, b) => a + b, 0) / scores.length) : 1.0;

    const recencyWeights = scores.map((_, i) => 1 + (totalGames - i) / totalGames);
    const weightedScoreCounts = scores.reduce((acc, score, i) => {
        acc[score] = (acc[score] || 0) + recencyWeights[i];
        return acc;
    }, {});

    return {
        scoreCounts,
        weightedScoreCounts,
        taiProb: taiCount / totalGames || 0.5,
        xiuProb: xiuCount / totalGames || 0.5,
        transitionProbs,
        diceProbs,
        meanScore,
        stdScore,
        bonusCounts
    };
}

// --- Enhanced Prediction Algorithms ---
function duDoanTX(historicalData, prevTong, recentScores) {
    const prevResult = getTaiXiu(prevTong);
    let taiProb = historicalData.taiProb;
    let xiuProb = historicalData.xiuProb;
    const transitionProbs = historicalData.transitionProbs;

    if (prevResult === "Tài") {
        taiProb *= transitionProbs["Tài->Tài"];
        xiuProb *= transitionProbs["Tài->Xỉu"];
    } else {
        taiProb *= transitionProbs["Xỉu->Tài"];
        xiuProb *= transitionProbs["Xỉu->Xỉu"];
    }

    const recentTaiCount = recentScores.filter(score => score >= 11).length;
    const recentWeight = recentTaiCount / (recentScores.length || 1);
    taiProb = (taiProb * 0.7) + (recentWeight * 0.3);
    xiuProb = (xiuProb * 0.7) + ((1 - recentWeight) * 0.3);

    const total = taiProb + xiuProb;
    if (total > 0) {
        taiProb /= total;
        xiuProb /= total;
    }

    return {
        prediction: taiProb > xiuProb ? "Tài" : "Xỉu",
        confidence: Math.max(taiProb, xiuProb)
    };
}

function duDoan3Tong(faces, historicalData) {
    const weightedScoreCounts = historicalData.weightedScoreCounts;
    const baseSum = faces.reduce((a, b) => a + b, 0);

    const possibleSums = [];
    for (let s = Math.max(3, baseSum - 3); s <= Math.min(18, baseSum + 3); s++) {
        possibleSums.push(s);
    }

    const totalCount = Object.values(weightedScoreCounts).reduce((a, b) => a + b, 0) || 1;
    const sumProbs = possibleSums.map(s => ({
        sum: s,
        prob: (weightedScoreCounts[s] || 0) / totalCount
    }));

    sumProbs.sort((a, b) => b.prob - a.prob);

    const topSums = sumProbs.slice(0, 3).map(s => s.sum);
    return topSums.length > 0 ? topSums : [baseSum, baseSum + 1, baseSum + 2];
}

function doTinCay(tong, historicalData) {
    const meanScore = historicalData.meanScore;
    const stdScore = historicalData.stdScore;

    const zScore = stdScore > 0 ? Math.abs(tong - meanScore) / stdScore : 0;
    let confidence = 0.95 - 0.1 * zScore;
    confidence = Math.max(0.5, Math.min(0.95, confidence));

    return `${Math.round(confidence * 100)}%`;
}

// --- AI Model for Tài/Xỉu Prediction ---
function trainAIModel(data) {
    const results = data.data.resultList || [];
    const features = [];
    const labels = [];

    for (let i = 1; i < results.length; i++) {
        const prevScore = results[i].score;
        const currScore = results[i - 1].score;
        const lastFiveScores = results.slice(Math.max(0, i - 5), i).map(r => r.score);
        const taiRatio = lastFiveScores.filter(s => s >= 11).length / (lastFiveScores.length || 1);
        const bonusCount = results[i].lastBonusCount || 0;

        features.push([prevScore, taiRatio, bonusCount]);
        labels.push(currScore >= 11 ? 1 : 0);
    }

    if (features.length < 10) {
        return null;
    }

    const model = new LogisticRegression({
        numSteps: 1000,
        learningRate: 0.1
    });
    model.train(features, labels);

    return model;
}

function predictWithAI(model, prevScore, recentScores, bonusCount) {
    if (!model) {
        return { prediction: "Không đủ dữ liệu", confidence: 0.5 };
    }

    const taiRatio = recentScores.filter(s => s >= 11).length / (recentScores.length || 1);
    const features = [[prevScore, taiRatio, bonusCount]];

    const prediction = model.predict(features)[0];
    const probabilities = model.predictProba(features)[0];

    return {
        prediction: prediction === 1 ? "Tài" : "Xỉu",
        confidence: prediction === 1 ? probabilities[1] : probabilities[0]
    };
}

// --- API Endpoints ---
app.get("/api/taixiu", async (req, res) => {
    try {
        const response = await fetch(SOURCE_URL);
        if (!response.ok) {
            return res.status(response.status).json({ error: "Failed to fetch data from source API." });
        }
        const data = await response.json();

        const results = data.data.resultList;
        if (!results || results.length < 2) {
            return res.status(404).json({ error: "Insufficient data for prediction" });
        }

        const historicalData = analyzeHistoricalData(data);
        const latest = results[0];
        const prevTong = results[1].score;
        const recentScores = results.slice(0, 5).map(r => r.score);
        const bonusCount = latest.lastBonusCount || 0;

        const phien = latest.gameNum;
        const tong = latest.score;
        const faces = latest.facesList;

        const { prediction: txPrediction, confidence: txConfidence } = duDoanTX(historicalData, prevTong, recentScores);
        const aiModel = trainAIModel(data);
        const { prediction: aiPrediction, confidence: aiConfidence } = predictWithAI(aiModel, prevTong, recentScores, bonusCount);

        const result = {
            phien_truoc: phien,
            xuc_xac: faces,
            tong: tong,
            md5: latest.md5,
            phien_sau: `#${parseInt(phien.replace('#', '')) + 1}`,
            du_doan: {
                statistical: {
                    prediction: txPrediction,
                    confidence: `${Math.round(txConfidence * 100)}%`
                },
                ai: {
                    prediction: aiPrediction,
                    confidence: `${Math.round(aiConfidence * 100)}%`
                }
            },
            doan_vi: duDoan3Tong(faces, historicalData),
            do_tin_cay: doTinCay(tong, historicalData)
        };

        res.json(result);

    } catch (error) {
        console.error("Error fetching or processing data:", error);
        res.status(500).json({ error: "Failed to fetch data or internal server error" });
    }
});

app.get("/api/validate", async (req, res) => {
    try {
        const response = await fetch(SOURCE_URL);
        if (!response.ok) {
            return res.status(response.status).json({ error: "Failed to fetch data from source API." });
        }
        const data = await response.json();

        const results = data.data.resultList;
        if (!results || results.length < 2) {
            return res.status(400).json({ error: "Insufficient data for validation" });
        }

        const historicalData = analyzeHistoricalData(data);
        const aiModel = trainAIModel(data);
        let correctTX = 0;
        let correctAITX = 0;
        let correctVi = 0;
        const total = results.length - 1;

        for (let i = 1; i < results.length; i++) {
            const prevResult = results[i].score;
            const currResult = results[i - 1].score;
            const currFaces = results[i - 1].facesList;
            const recentScores = results.slice(Math.max(0, i - 5), i).map(r => r.score);
            const bonusCount = results[i - 1].lastBonusCount || 0;

            const { prediction } = duDoanTX(historicalData, prevResult, recentScores);
            const actual = getTaiXiu(currResult);
            if (prediction === actual) {
                correctTX++;
            }

            const { prediction: aiPrediction } = predictWithAI(aiModel, prevResult, recentScores, bonusCount);
            if (aiPrediction === actual) {
                correctAITX++;
            }

            const predictedSums = duDoan3Tong(currFaces, historicalData);
            if (currResult && predictedSums.includes(currResult)) {
                correctVi++;
            }
        }

        const txAccuracy = (correctTX / total) * 100;
        const aiTxAccuracy = (correctAITX / total) * 100;
        const viAccuracy = (correctVi / total) * 100;

        res.json({
            statistical_tai_xiu_accuracy: `${txAccuracy.toFixed(2)}%`,
            ai_tai_xiu_accuracy: `${aiTxAccuracy.toFixed(2)}%`,
            dice_outcome_accuracy: `${viAccuracy.toFixed(2)}%`,
            total_games_analyzed: total
        });

    } catch (error) {
        console.error("Error fetching or processing data for validation:", error);
        res.status(500).json({ error: "Failed to fetch data or internal server error" });
    }
});

app.get("/", (req, res) => {
    res.send("API server for Tài Xỉu is running.");
});

// --- Server Startup ---
app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});
