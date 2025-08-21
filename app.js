// Import necessary modules
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
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

    // Calculate frequency of scores and Tài/Xỉu
    const scoreCounts = scores.reduce((acc, score) => {
        acc[score] = (acc[score] || 0) + 1;
        return acc;
    }, {});
    const totalGames = scores.length;
    const taiCount = scores.filter(score => score >= 11).length;
    const xiuCount = totalGames - taiCount;

    // Calculate transition probabilities
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

    // Calculate dice face frequencies
    const allFaces = [].concat(...facesList);
    const diceFrequencies = allFaces.reduce((acc, face) => {
        acc[face] = (acc[face] || 0) + 1;
        return acc;
    }, {});
    const diceProbs = {};
    for (let i = 1; i <= 6; i++) {
        diceProbs[i] = (diceFrequencies[i] || 0) / (totalGames * 3);
    }

    // Calculate mean and standard deviation of scores
    const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 10.5;
    const stdScore = scores.length > 0 ? Math.sqrt(scores.map(s => Math.pow(s - meanScore, 2)).reduce((a, b) => a + b) / scores.length) : 1.0;

    return {
        scoreCounts,
        taiProb: taiCount / totalGames || 0.5,
        xiuProb: xiuCount / totalGames || 0.5,
        transitionProbs,
        diceProbs,
        meanScore,
        stdScore
    };
}

function duDoanTX(historicalData, prevTong) {
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
    const scoreCounts = historicalData.scoreCounts;
    const baseSum = faces.reduce((a, b) => a + b, 0);

    const possibleSums = [];
    for (let s = Math.max(3, baseSum - 3); s <= Math.min(18, baseSum + 3); s++) {
        possibleSums.push(s);
    }
    
    const totalCount = Object.values(scoreCounts).reduce((a, b) => a + b, 0);
    const sumProbs = possibleSums.map(s => ({
        sum: s,
        prob: (scoreCounts[s] || 0) / (totalCount || 1)
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

// --- API Endpoints ---
app.get("/api/taixiu", async (req, res) => {
    try {
        const response = await fetch(SOURCE_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        const results = data.data.resultList;
        if (!results || results.length < 2) {
            return res.status(404).json({ error: "Insufficient data for prediction" });
        }

        const historicalData = analyzeHistoricalData(data);
        const latest = results[0];
        const prevTong = results[1].score;

        const phien = latest.gameNum;
        const tong = latest.score;
        const faces = latest.facesList;

        const { prediction, confidence } = duDoanTX(historicalData, prevTong);
        
        const result = {
            "phien_truoc": phien,
            "xuc_xac": faces,
            "tong": tong,
            "md5": latest.md5,
            "phien_sau": `#${parseInt(phien.replace('#', '')) + 1}`,
            "du_doan": prediction,
            "du_doan_confidence": `${Math.round(confidence * 100)}%`,
            "doan_vi": duDoan3Tong(faces, historicalData),
            "do_tin_cay": doTinCay(tong, historicalData)
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
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        const results = data.data.resultList;
        if (!results || results.length < 2) {
            return res.status(400).json({ error: "Insufficient data for validation" });
        }
        
        const historicalData = analyzeHistoricalData(data);
        let correctTX = 0;
        let correctVi = 0;
        const total = results.length - 1;

        for (let i = 1; i < results.length; i++) {
            const prevResult = results[i].score;
            const currResult = results[i-1].score;
            const currFaces = results[i-1].facesList;

            // Validate Tài/Xỉu
            const { prediction } = duDoanTX(historicalData, prevResult);
            const actual = getTaiXiu(currResult);
            if (prediction === actual) {
                correctTX++;
            }
            
            // Validate dice outcome
            const predictedSums = duDoan3Tong(currFaces, historicalData);
            if (currResult && predictedSums.includes(currResult)) {
                correctVi++;
            }
        }
        
        const txAccuracy = (correctTX / total) * 100;
        const viAccuracy = (correctVi / total) * 100;

        res.json({
            "tai_xiu_accuracy": `${txAccuracy.toFixed(2)}%`,
            "dice_outcome_accuracy": `${viAccuracy.toFixed(2)}%`,
            "total_games_analyzed": total
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
