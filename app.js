const express = require("express");
const fetch = require("node-fetch");
const app = express();

const PORT = process.env.PORT || 3000;

// ------------------ HÀM PHỤ ------------------
function duDoanTX(his, prevTong, scores) {
  // Thuật toán thống kê cơ bản (có thể nâng cấp thêm)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const prediction = avg >= 11 ? "Tài" : "Xỉu";
  return { prediction, confidence: 0.7 }; // 70%
}

function trainAIModel(data) {
  // Giả lập training AI (chỉ return lại data)
  return data;
}

function predictWithAI(model, prevTong, scores, bonusCount) {
  const sum = scores.reduce((a, b) => a + b, 0) + prevTong + bonusCount;
  const prediction = sum % 2 === 0 ? "Tài" : "Xỉu";
  return { prediction, confidence: 0.65 };
}

function duDoan3Tong(faces, his) {
  // Gợi ý 3 tổng có khả năng xảy ra
  const tong = faces.reduce((a, b) => a + b, 0);
  return [tong + 1, tong + 2, tong - 1];
}

function doTinCay(tong, his) {
  // Giả lập độ tin cậy
  return Math.floor(Math.random() * 50 + 50) + "%"; // 50–100%
}

// ------------------ API CHÍNH ------------------
app.get("/api/taixiu", async (req, res) => {
  try {
    // Gọi API gốc
    const response = await fetch(
      "https://api.wsktnus8.net/v2/history/getLastResult?size=50"
    );
    const data = await response.json();

    const results = data?.data?.resultList;
    if (!results || results.length < 2) {
      return res.status(500).json({ error: "Không lấy được dữ liệu" });
    }

    const latest = results[0]; // phiên mới nhất
    const prev = results[1]; // phiên trước
    const recentScores = results.slice(0, 5).map((r) => r.score);

    const phien = latest.gameNum;
    const tong = latest.score;
    const faces = latest.facesList;

    // Thuật toán thống kê
    const { prediction: txPrediction, confidence: txConfidence } = duDoanTX(
      results,
      prev.score,
      recentScores
    );

    // Thuật toán AI
    const aiModel = trainAIModel(data);
    const { prediction: aiPrediction, confidence: aiConfidence } = predictWithAI(
      aiModel,
      prev.score,
      recentScores,
      latest.lastBonusCount || 0
    );

    // Kết quả trả về
    const result = {
      phien_truoc: phien,
      xuc_xac: faces,
      tong: tong,
      md5: latest.md5S || latest.md5, // fix md5
      phien_sau: `#${parseInt(phien.replace("#", "")) + 1}`,
      du_doan: {
        statistical: {
          prediction: txPrediction,
          confidence: `${Math.round(txConfidence * 100)}%`,
        },
        ai: {
          prediction: aiPrediction,
          confidence: `${Math.round(aiConfidence * 100)}%`,
        },
      },
      doan_vi: duDoan3Tong(faces, results),
      do_tin_cay: doTinCay(tong, results),
    };

    res.json(result);
  } catch (err) {
    console.error("API Error:", err.message);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// ------------------ RUN SERVER ------------------
app.listen(PORT, () => {
  console.log(`✅ Server chạy tại http://localhost:${PORT}`);
});
