      // 页面元素
      const referenceFileInput = document.getElementById("referenceFileInput");
      const loadReferenceButton = document.getElementById(
        "loadReferenceButton"
      );
      const referenceVideo = document.getElementById("referenceVideo");
      const referenceCanvas = document.getElementById("referenceCanvas");
      const referenceCtx = referenceCanvas.getContext("2d");
      const referencePlayButton = document.getElementById(
        "referencePlayButton"
      );
      const referencePauseButton = document.getElementById(
        "referencePauseButton"
      );
      const referenceAnalyzeButton = document.getElementById(
        "referenceAnalyzeButton"
      );
      const referenceCurrentTime = document.getElementById(
        "referenceCurrentTime"
      );
      const referenceTotalTime = document.getElementById("referenceTotalTime");
      const referenceProgressBar = document.getElementById(
        "referenceProgressBar"
      );
      const referenceAngleData = document.getElementById("referenceAngleData");
      const loadReferenceExampleButton = document.getElementById("loadReferenceExampleButton");
      const referenceVideoSection = document.getElementById("referenceVideoSection");

      const targetFileInput = document.getElementById("targetFileInput");
      const loadTargetButton = document.getElementById("loadTargetButton");
      const loadTargetExampleButton = document.getElementById("loadTargetExampleButton");
      const useCameraButton = document.getElementById("useCameraButton");
      const stopCameraButton = document.getElementById("stopCameraButton");
      const targetVideoSection = document.getElementById("targetVideoSection");
      const targetVideo = document.getElementById("targetVideo");
      const targetCanvas = document.getElementById("targetCanvas");
      const targetCtx = targetCanvas.getContext("2d");
      const targetPlayButton = document.getElementById("targetPlayButton");
      const targetPauseButton = document.getElementById("targetPauseButton");
      const targetAnalyzeButton = document.getElementById(
        "targetAnalyzeButton"
      );
      const targetCurrentTime = document.getElementById("targetCurrentTime");
      const targetTotalTime = document.getElementById("targetTotalTime");
      const targetProgressBar = document.getElementById("targetProgressBar");
      const targetAngleData = document.getElementById("targetAngleData");

      // 游戏模式相关元素
      const gameModeContainer = document.getElementById("gameModeContainer");
      const gameReferenceVideo = document.getElementById("gameReferenceVideo");
      const gameTargetVideo = document.getElementById("gameTargetVideo");
      const gameScore = document.getElementById("gameScore");
      const currentWindowSimilarity = document.getElementById(
        "currentWindowSimilarity"
      );
      const exitGameButton = document.getElementById("exitGameButton");
      const startGameButton = document.getElementById("startGameButton");
      const countdownDisplay = document.getElementById("countdown"); // 倒计时显示元素

      // 摄像头相关变量
      let cameraStream = null;

      // 模型相关变量
      let referencePoseDetector = null;
      let targetPoseDetector = null;

      // 视频状态变量
      let referenceLoaded = false;
      let targetLoaded = false;
      let comparisonRunning = false;
      let gameModeRunning = false; // 游戏模式运行状态

      // 帧缓存用于一秒内的上下文比较
      let referenceFrameBuffer = [];
      let targetFrameBuffer = [];
      let currentSecond = -1;

      // 新增：用于存储每拍的最高相似度分数和总分
      let scoresPerBeat = [];
      let totalScore = 120; // 初始总分为100
      let lastRecordedTime = 0; // 上次记录时间
      let maxSimilarityInCurrentInterval = 0; // 当前间隔内的最高相似度
      let beatInterval = 60 / 120; // 每拍的时间间隔（秒），默认120 BPM

      // 上一次关键点缓存，用于处理置信度不足的情况
      let lastReferenceKeypoints = {};
      let lastTargetKeypoints = {};

      // 滑动窗口参数
      const WINDOW_SIZE = 15; // 窗口大小（帧数）

      // 上一次角度缓存，用于处理角度丢失的情况
      let lastReferenceAngles = {};
      let lastTargetAngles = {};

      // 关键点定义（排除脸部关键点）
      const KEYPOINT_NAMES = [
        "nose", // 0
        "left_eye", // 1
        "right_eye", // 2
        "left_ear", // 3
        "right_ear", // 4
        "left_shoulder", // 5
        "right_shoulder", // 6
        "left_elbow", // 7
        "right_elbow", // 8
        "left_wrist", // 9
        "right_wrist", // 10
        "left_hip", // 11
        "right_hip", // 12
        "left_knee", // 13
        "right_knee", // 14
        "left_ankle", // 15
        "right_ankle", // 16
      ];

      // 定义关键点的父子关系（排除脸部关键点）
      const KEYPOINT_PARENTS = {
        left_elbow: "left_shoulder",
        right_elbow: "right_shoulder",
        left_wrist: "left_elbow",
        right_wrist: "right_elbow",
        left_knee: "left_hip",
        right_knee: "right_hip",
        left_ankle: "left_knee",
        right_ankle: "right_knee",
      };

      // 定义肢体名称
      const LIMB_NAMES = {
        left_elbow: "左上臂",
        right_elbow: "右上臂",
        left_wrist: "左前臂",
        right_wrist: "右前臂",
        left_knee: "左大腿",
        right_knee: "右大腿",
        left_ankle: "左小腿",
        right_ankle: "右小腿",
      };

      // 关键点颜色
      const KEYPOINT_COLORS = {
        left_shoulder: "#ff0000", // 红色
        right_shoulder: "#00ff00", // 绿色
        left_elbow: "#ff00ff", // 品红
        right_elbow: "#ffff00", // 黄色
        left_wrist: "#00ffff", // 青色
        right_wrist: "#ffa500", // 橙色
        left_hip: "#800080", // 紫色
        right_hip: "#008000", // 深绿色
        left_knee: "#0000ff", // 蓝色
        right_knee: "#ffc0cb", // 粉色
        left_ankle: "#a52a2a", // 棕色
        right_ankle: "#808080", // 灰色
      };

      // 时间格式化函数
      function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, "0")}:${secs
          .toString()
          .padStart(2, "0")}`;
      }

      // 计算两点之间的角度
      function calculateAngle(parentPoint, childPoint) {
        if (!parentPoint || !childPoint) return null;

        const deltaX = childPoint.x - parentPoint.x;
        const deltaY = childPoint.y - parentPoint.y;

        // 计算角度（以父节点为原点，计算子节点相对于父节点的角度）
        let angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;

        // 确保角度在0-360范围内
        if (angle < 0) {
          angle += 360;
        }

        return angle;
      }

      // 计算所有关键点相对于父节点的角度
      function calculateAllAngles(keypoints) {
        const angles = {};

        // 创建一个关键点映射，方便查找
        const keypointsMap = {};
        keypoints.forEach((kp) => {
          keypointsMap[kp.name] = kp;
        });

        // 计算每个关键点相对于父节点的角度
        for (const [keypointName, parentName] of Object.entries(
          KEYPOINT_PARENTS
        )) {
          // 跳过根节点（没有父节点的关键点）
          if (parentName === null) {
            angles[keypointName] = null;
            continue;
          }

          const keypoint = keypointsMap[keypointName];
          const parentPoint = keypointsMap[parentName];

          // 只计算置信度大于0.2的关键点
          if (
            keypoint &&
            parentPoint &&
            keypoint.score >= 0.2 &&
            parentPoint.score >= 0.2
          ) {
            angles[keypointName] = calculateAngle(parentPoint, keypoint);
          } else {
            angles[keypointName] = null;
          }
        }

        return angles;
      }

      // 在canvas上绘制关键点和连线
      function drawKeypoints(ctx, keypoints, angles, frameBuffer) {
        // 创建一个关键点映射，方便查找
        const keypointsMap = {};
        keypoints.forEach((kp) => {
          keypointsMap[kp.name] = kp;
        });

        // 绘制连接线
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;

        // 绘制骨架连接线
        const connections = [
          ["left_shoulder", "right_shoulder"],
          ["left_shoulder", "left_hip"],
          ["right_shoulder", "right_hip"],
          ["left_shoulder", "left_elbow"],
          ["right_shoulder", "right_elbow"],
          ["left_elbow", "left_wrist"],
          ["right_elbow", "right_wrist"],
          ["left_hip", "right_hip"],
          ["left_hip", "left_knee"],
          ["right_hip", "right_knee"],
          ["left_knee", "left_ankle"],
          ["right_knee", "right_ankle"],
        ];

        connections.forEach(([start, end]) => {
          const startPoint = keypointsMap[start];
          const endPoint = keypointsMap[end];

          if (
            startPoint &&
            endPoint &&
            startPoint.score >= 0.2 &&
            endPoint.score >= 0.2
          ) {
            ctx.beginPath();
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.lineTo(endPoint.x, endPoint.y);
            ctx.stroke();
          }
        });

        // 绘制关键点和角度
        for (const keypointName in KEYPOINT_PARENTS) {
          const keypoint = keypointsMap[keypointName];
          const parentName = KEYPOINT_PARENTS[keypointName];
          const parentPoint = parentName ? keypointsMap[parentName] : null;

          if (keypoint && keypoint.score >= 0.2) {
            // 绘制关键点
            ctx.fillStyle = KEYPOINT_COLORS[keypointName] || "#ffffff";
            ctx.beginPath();
            ctx.arc(keypoint.x, keypoint.y, 5, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
      }

      // 绘制1秒内的运动轨迹
      function drawTrajectory(ctx, frameBuffer, keypointNames) {
        // 只绘制指定的关键点轨迹
        keypointNames.forEach((keypointName) => {
          const trajectoryPoints = [];

          // 收集1秒内的轨迹点
          frameBuffer.forEach((frame) => {
            const keypoint = frame.keypoints.find(
              (kp) => kp.name === keypointName
            );
            if (keypoint && keypoint.score >= 0.2) {
              trajectoryPoints.push(keypoint);
            }
          });

          // 绘制轨迹线（使用贝塞尔曲线）
          if (trajectoryPoints.length > 1) {
            ctx.strokeStyle = KEYPOINT_COLORS[keypointName] || "#ffffff";
            ctx.lineWidth = 10;
            ctx.beginPath();

            // 如果只有两个点，绘制直线
            if (trajectoryPoints.length === 2) {
              ctx.moveTo(trajectoryPoints[0].x, trajectoryPoints[0].y);
              ctx.lineTo(trajectoryPoints[1].x, trajectoryPoints[1].y);
            }
            // 如果有三个或更多点，使用贝塞尔曲线
            else if (trajectoryPoints.length >= 3) {
              ctx.moveTo(trajectoryPoints[0].x, trajectoryPoints[0].y);

              // 对于中间的点，使用贝塞尔曲线连接
              for (let i = 1; i < trajectoryPoints.length - 1; i++) {
                const xc =
                  (trajectoryPoints[i].x + trajectoryPoints[i + 1].x) / 2;
                const yc =
                  (trajectoryPoints[i].y + trajectoryPoints[i + 1].y) / 2;
                ctx.quadraticCurveTo(
                  trajectoryPoints[i].x,
                  trajectoryPoints[i].y,
                  xc,
                  yc
                );
              }

              // 连接到最后一个点
              ctx.quadraticCurveTo(
                trajectoryPoints[trajectoryPoints.length - 1].x,
                trajectoryPoints[trajectoryPoints.length - 1].y,
                trajectoryPoints[trajectoryPoints.length - 1].x,
                trajectoryPoints[trajectoryPoints.length - 1].y
              );
            }

            ctx.stroke();
          }
        });
      }

      // 显示角度数据
      function displayAngleData(angleData, container) {
        let html = "";

        for (const [keypointName, angle] of Object.entries(angleData)) {
          if (angle !== null && angle !== undefined) {
            html += `<div class="angle-item">${keypointName}: ${angle.toFixed(
              2
            )}°</div>`;
          } else {
            html += `<div class="angle-item">${keypointName}: 无法计算</div>`;
          }
        }

        container.innerHTML = html;
      }

      // 比较两个角度数据的相似度
      function compareAngles(referenceAngles, targetAngles) {
        // 添加容错处理
        if (!referenceAngles || !targetAngles) {
          return {
            similarity: 0,
            averageDifference: 0,
            validCount: 0,
          };
        }

        let totalDifference = 0;
        let validCount = 0;

        // 计算参考视频和目标视频的平均肩膀距离
        let refShoulderDistances = referenceFrameBuffer
          .map((frame) => frame.shoulderDistance)
          .filter((dist) => dist > 0);

        let targetShoulderDistances = targetFrameBuffer
          .map((frame) => frame.shoulderDistance)
          .filter((dist) => dist > 0);

        let avgRefShoulderDistance = 0;
        let avgTargetShoulderDistance = 0;

        if (refShoulderDistances.length > 0) {
          const refSum = refShoulderDistances.reduce(
            (acc, val) => acc + val,
            0
          );
          avgRefShoulderDistance = refSum / refShoulderDistances.length;
        }

        if (targetShoulderDistances.length > 0) {
          const targetSum = targetShoulderDistances.reduce(
            (acc, val) => acc + val,
            0
          );
          avgTargetShoulderDistance =
            targetSum / targetShoulderDistances.length;
        }

        // 比较关键点角度
        for (const keypointName in referenceAngles) {
          // 添加容错处理
          if (
            !referenceAngles.hasOwnProperty(keypointName) ||
            !targetAngles.hasOwnProperty(keypointName)
          ) {
            continue;
          }

          const refAngle = referenceAngles[keypointName];
          const targetAngle = targetAngles[keypointName];

          // 只有当两个角度都有效时才进行比较
          if (
            refAngle !== null &&
            refAngle !== undefined &&
            targetAngle !== null &&
            targetAngle !== undefined
          ) {
            // 计算角度差值（考虑角度循环特性）
            let diff = Math.abs(refAngle - targetAngle);
            if (diff > 180) {
              diff = 360 - diff;
            }
            // 如果角度差值小于30度，则认为角度相同
            if (diff < 30) {
              diff = 0;
            }

            // 特殊处理：如果平均肩膀距离有效，并且当前关键点是手腕或脚踝
            if (
              avgRefShoulderDistance > 0 &&
              avgTargetShoulderDistance > 0 &&
              (keypointName.includes("wrist") ||
                keypointName.includes("ankle")) &&
              referenceFrameBuffer.length > 0 &&
              targetFrameBuffer.length > 0
            ) {
              const refFrame =
                referenceFrameBuffer[referenceFrameBuffer.length - 1];
              const targetFrame =
                targetFrameBuffer[targetFrameBuffer.length - 1];

              if (refFrame.keypoints && targetFrame.keypoints) {
                const refKeypoint = refFrame.keypoints.find(
                  (kp) => kp.name === keypointName
                );
                const targetKeypoint = targetFrame.keypoints.find(
                  (kp) => kp.name === keypointName
                );

                // 检查关键点置信度
                if (
                  refKeypoint &&
                  targetKeypoint &&
                  refKeypoint.score >= 0.2 &&
                  targetKeypoint.score >= 0.2
                ) {
                  // 计算当前关键点之间的距离
                  const keypointDistance = Math.hypot(
                    refKeypoint.x - targetKeypoint.x,
                    refKeypoint.y - targetKeypoint.y
                  );

                  // 分别检查与参考视频和目标视频的肩膀距离关系
                  if (
                    keypointDistance < avgRefShoulderDistance / 2 ||
                    keypointDistance < avgTargetShoulderDistance / 2
                  ) {
                    diff = 0;
                  }
                }
              }
            }

            totalDifference += diff;
            validCount++;
          }
        }

        // 计算平均差异
        const averageDifference =
          validCount > 0 ? totalDifference / validCount : 0;

        // 将差异转换为相似度百分比（差异越小，相似度越高）
        const similarity = Math.max(0, 100 - totalDifference);

        return {
          similarity: similarity,
          averageDifference: averageDifference,
          validCount: validCount,
        };
      }

      // 计算上半身相似度
      function calculateUpperBodySimilarity(referenceAngles, targetAngles) {
        if (!referenceAngles || !targetAngles) {
          return 0;
        }

        const upperBodyLimbs = [
          "left_elbow",
          "right_elbow",
          "left_wrist",
          "right_wrist",
        ];
        let totalDifference = 0;
        let validCount = 0;

        for (const limb of upperBodyLimbs) {
          const refAngle = referenceAngles[limb];
          const targetAngle = targetAngles[limb];

          if (
            refAngle !== null &&
            refAngle !== undefined &&
            targetAngle !== null &&
            targetAngle !== undefined
          ) {
            let diff = Math.abs(refAngle - targetAngle);
            if (diff > 180) {
              diff = 360 - diff;
            }
            // 如果角度差值小于60度，则认为角度相同
            if (diff < 30) {
              diff = 0;
            }

            totalDifference += diff;
            validCount++;
          }
        }

        // 计算上半身相似度
        const similarity =
          validCount > 0 ? Math.max(0, 100 - totalDifference) : 0;
        return similarity;
      }

      // 计算下半身相似度
      function calculateLowerBodySimilarity(referenceAngles, targetAngles) {
        if (!referenceAngles || !targetAngles) {
          return 0;
        }

        const lowerBodyLimbs = [
          "left_knee",
          "right_knee",
          "left_ankle",
          "right_ankle",
        ];
        let totalDifference = 0;
        let validCount = 0;

        for (const limb of lowerBodyLimbs) {
          const refAngle = referenceAngles[limb];
          const targetAngle = targetAngles[limb];

          if (
            refAngle !== null &&
            refAngle !== undefined &&
            targetAngle !== null &&
            targetAngle !== undefined
          ) {
            let diff = Math.abs(refAngle - targetAngle);
            if (diff > 180) {
              diff = 360 - diff;
            }
            // 如果角度差值小于20度，则认为角度相同
            if (diff < 20) {
              diff = 0;
            }

            totalDifference += diff;
            validCount++;
          }
        }

        // 计算下半身相似度
        const similarity =
          validCount > 0 ? Math.max(0, 100 - totalDifference) : 0;
        return similarity;
      }

      // 比较一秒内所有帧的角度，返回最高相似度
      function compareBufferFrames(referenceBuffer, targetBuffer) {
        let maxSimilarity = 0;
        let bestComparison = null;
        let bestReferenceAngles = null;
        let bestTargetAngles = null;

        // 比较每一帧
        for (const refFrame of referenceBuffer) {
          for (const targetFrame of targetBuffer) {
            if (refFrame.angles && targetFrame.angles) {
              // 计算上半身和下半身相似度
              const upperBodySim = calculateUpperBodySimilarity(
                refFrame.angles,
                targetFrame.angles
              );
              const lowerBodySim = calculateLowerBodySimilarity(
                refFrame.angles,
                targetFrame.angles
              );
              
              // 应用权重：上半身80%，下半身20%
              const weightedSimilarity = (upperBodySim * 0.8) + (lowerBodySim * 0.2);
              
              if (weightedSimilarity > maxSimilarity) {
                maxSimilarity = weightedSimilarity;
                bestComparison = {
                  similarity: weightedSimilarity,
                  averageDifference: 0, // 可以根据需要计算
                  validCount: 0 // 可以根据需要计算
                };
                bestReferenceAngles = refFrame.angles;
                bestTargetAngles = targetFrame.angles;
              }
            }
          }
        }

        // displayLimbSimilarity(bestReferenceAngles, bestTargetAngles);
        return {
          similarity: maxSimilarity,
          comparison: bestComparison,
          referenceAngles: bestReferenceAngles,
          targetAngles: bestTargetAngles,
        };
      }

      // 加载MoveNet模型
      async function loadMoveNetModel() {
        try {
          // 创建参考视频的姿态检测器
          referencePoseDetector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            {
              modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
              enableSmoothing: true,
              modelUrl: "./models/model.json",
            }
          );

          // 创建对比视频的姿态检测器
          targetPoseDetector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            {
              modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
              enableSmoothing: true,
              modelUrl: "./models/model.json",
            }
          );

          console.log("MoveNet模型加载完成");
        } catch (error) {
          console.error("加载MoveNet模型失败:", error);
        }
      }

      // 检测姿态
      async function detectPose(video, canvas, ctx, poseDetector) {
        if (!poseDetector) return [];

        try {
          // 使用MoveNet检测姿态
          const poses = await poseDetector.estimatePoses(video, {
            maxPoses: 1,
            flipHorizontal: false,
          });

          if (poses && poses.length > 0) {
            return poses[0].keypoints;
          }
        } catch (error) {
          console.error("姿态检测出错:", error);
        }

        return [];
      }

      // 加载参考视频
      loadReferenceButton.addEventListener("click", () => {
        if (referenceFileInput.files.length > 0) {
          const file = referenceFileInput.files[0];
          const url = URL.createObjectURL(file);
          referenceVideo.src = url;
        }
        if (referenceVideo) {
          startGameButton.disabled = false;
        }
      });

      // 加载对比视频
      loadTargetButton.addEventListener("click", () => {
        // 如果正在使用摄像头，先停止摄像头
        if (cameraStream) {
          stopCamera();
        }

        if (targetFileInput.files.length > 0) {
          const file = targetFileInput.files[0];
          const url = URL.createObjectURL(file);
          targetVideo.src = url;
        }
      });

      // 加载示例视频函数
      function loadExampleVideo(videoElement, examplePath) {
        videoElement.src = examplePath;
        videoElement.load();
      }

      // 加载视频文件函数
      function loadVideoFile(videoElement, fileInput, file) {
        if (file && file.type.startsWith('video/')) {
          const url = URL.createObjectURL(file);
          videoElement.src = url;
          videoElement.load();

        } else if (file && file.name.endsWith('.flv')) {
          // 对于.flv文件，可能需要特殊处理
          const url = URL.createObjectURL(file);
          videoElement.src = url;
          videoElement.load();

        } else {
          alert('请选择视频文件');
        }
      }

      // 为参考视频和对比视频区域添加拖拽事件监听
      referenceVideoSection.addEventListener("dragover", (e) => {
        e.preventDefault();
        referenceVideoSection.style.borderColor = "var(--primary-color)";
        referenceVideoSection.style.borderWidth = "2px";
        referenceVideoSection.style.borderStyle = "dashed";
      });

      referenceVideoSection.addEventListener("dragleave", () => {
        referenceVideoSection.style.borderColor = "";
        referenceVideoSection.style.borderWidth = "";
        referenceVideoSection.style.borderStyle = "";
      });

      referenceVideoSection.addEventListener("drop", (e) => {
        e.preventDefault();
        referenceVideoSection.style.borderColor = "";
        referenceVideoSection.style.borderWidth = "";
        referenceVideoSection.style.borderStyle = "";
        if (e.dataTransfer.files.length) {
          loadVideoFile(referenceVideo, referenceFileInput, e.dataTransfer.files[0]);
        }
      });

      targetVideoSection.addEventListener("dragover", (e) => {
        e.preventDefault();
        targetVideoSection.style.borderColor = "var(--primary-color)";
        targetVideoSection.style.borderWidth = "2px";
        targetVideoSection.style.borderStyle = "dashed";
      });

      targetVideoSection.addEventListener("dragleave", () => {
        targetVideoSection.style.borderColor = "";
        targetVideoSection.style.borderWidth = "";
        targetVideoSection.style.borderStyle = "";
      });

      targetVideoSection.addEventListener("drop", (e) => {
        e.preventDefault();
        targetVideoSection.style.borderColor = "";
        targetVideoSection.style.borderWidth = "";
        targetVideoSection.style.borderStyle = "";
        if (e.dataTransfer.files.length) {
          loadVideoFile(targetVideo, targetFileInput, e.dataTransfer.files[0]);
        }
      });


      // 加载示例参考视频
      loadReferenceExampleButton.addEventListener("click", () => {
        loadExampleVideo(referenceVideo, "./res/example.flv");
      });


      // 加载示例对比视频
      loadTargetExampleButton.addEventListener("click", () => {
        loadExampleVideo(targetVideo, "./res/example.flv");
      });

      // 对比视频加载完成事件
      targetVideo.addEventListener("loadeddata", () => {
        targetLoaded = true;
        targetCanvas.width = targetVideo.videoWidth;
        targetCanvas.height = targetVideo.videoHeight;
        targetTotalTime.textContent = formatTime(targetVideo.duration);
        targetPlayButton.disabled = false;
        // targetAnalyzeButton.disabled = false;
        if (referenceLoaded) {
          startComparisonButton.disabled = false;
        }
      });

      // 使用摄像头
      useCameraButton.addEventListener("click", async () => {
        try {
          // 如果正在播放视频，先停止播放
          targetVideo.pause();

          // 获取摄像头流
          cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              facingMode: "user",
            },
            audio: false,
          });

          // 设置视频源为摄像头流
          targetVideo.srcObject = cameraStream;
          targetVideo.play();

          // 更新按钮状态
          useCameraButton.disabled = false;
          stopCameraButton.disabled = false;
          targetPlayButton.disabled = false;
          targetPauseButton.disabled = false;
          targetAnalyzeButton.disabled = false;
          targetLoaded = true;

          // 设置画布尺寸
          targetVideo.addEventListener(
            "loadedmetadata",
            () => {
              targetCanvas.width = targetVideo.videoWidth;
              targetCanvas.height = targetVideo.videoHeight;
              targetTotalTime.textContent = "Live";
            },
            { once: true }
          );

          // 启用开始比较按钮（如果参考视频已加载）
          if (referenceLoaded) {
            startComparisonButton.disabled = false;
          }
        } catch (err) {
          console.error("无法访问摄像头:", err);
        }
      });

      // 停止摄像头
      function stopCamera() {
        if (cameraStream) {
          const tracks = cameraStream.getTracks();
          tracks.forEach((track) => track.stop());
          cameraStream = null;
          targetVideo.srcObject = null;

          // 更新按钮状态
          useCameraButton.disabled = false;
          stopCameraButton.disabled = false;
          targetAnalyzeButton.disabled = false;
          targetLoaded = false;

          // 禁用开始比较按钮
          if (!targetFileInput.files.length) {
            startComparisonButton.disabled = false;
          }
        }
      }

      // 停止摄像头按钮事件
      stopCameraButton.addEventListener("click", stopCamera);

      // 参考视频加载完成事件
      referenceVideo.addEventListener("loadedmetadata", () => {
        referenceLoaded = true;
        referenceCanvas.width = referenceVideo.videoWidth;
        referenceCanvas.height = referenceVideo.videoHeight;
        referenceTotalTime.textContent = formatTime(referenceVideo.duration);
        referencePlayButton.disabled = false;
        referenceAnalyzeButton.disabled = false;
        if (targetLoaded) {
          startComparisonButton.disabled = false;
        }
      });

      // 对比视频加载完成事件
      targetVideo.addEventListener("loadedmetadata", () => {
        targetLoaded = true;
        targetCanvas.width = targetVideo.videoWidth;
        targetCanvas.height = targetVideo.videoHeight;
        targetTotalTime.textContent = formatTime(targetVideo.duration);
        targetPlayButton.disabled = false;
        targetAnalyzeButton.disabled = false;
        if (referenceLoaded) {
          startComparisonButton.disabled = false;
        }
      });

      // 参考视频播放按钮
      referencePlayButton.addEventListener("click", () => {
        referenceVideo.play();
      });

      // 参考视频暂停按钮
      referencePauseButton.addEventListener("click", () => {
        referenceVideo.pause();
      });

      // 对比视频播放按钮
      targetPlayButton.addEventListener("click", () => {
        targetVideo.play();
      });

      // 对比视频暂停按钮
      targetPauseButton.addEventListener("click", () => {
        targetVideo.pause();
      });

      // 参考视频播放事件
      referenceVideo.addEventListener("play", () => {
        referencePlayButton.disabled = false;
        referencePauseButton.disabled = false;
      });

      // 参考视频暂停事件
      referenceVideo.addEventListener("pause", () => {
        referencePlayButton.disabled = false;
        referencePauseButton.disabled = false;
      });

      // 对比视频播放事件
      targetVideo.addEventListener("play", () => {
        targetPlayButton.disabled = false;
        targetPauseButton.disabled = false;
      });

      // 对比视频暂停事件
      targetVideo.addEventListener("pause", () => {
        targetPlayButton.disabled = false;
        targetPauseButton.disabled = false;
      });

      // 参考视频时间更新
      referenceVideo.addEventListener("timeupdate", () => {
        const currentTime = referenceVideo.currentTime;
        const duration = referenceVideo.duration;
        referenceCurrentTime.textContent = formatTime(currentTime);
        referenceProgressBar.value = (currentTime / duration) * 100;
      });

      // 对比视频时间更新
      targetVideo.addEventListener("timeupdate", () => {
        // 如果正在使用摄像头，不更新进度条
        if (cameraStream) {
          targetCurrentTime.textContent = "Live";
          targetProgressBar.value = 0;
          return;
        }

        const currentTime = targetVideo.currentTime;
        const duration = targetVideo.duration;
        targetCurrentTime.textContent = formatTime(currentTime);
        targetProgressBar.value = (currentTime / duration) * 100;
      });

      // 参考视频进度条拖动
      referenceProgressBar.addEventListener("input", () => {
        const duration = referenceVideo.duration;
        const newTime = (referenceProgressBar.value / 100) * duration;
        referenceVideo.currentTime = newTime;
      });

      // 对比视频进度条拖动
      targetProgressBar.addEventListener("input", () => {
        const duration = targetVideo.duration;
        const newTime = (targetProgressBar.value / 100) * duration;
        targetVideo.currentTime = newTime;
      });

      // 开始比较按钮
      startComparisonButton.addEventListener("click", async () => {
        totalScore = 100; // 初始总分为100
        scoresPerBeat = [];
        if (!referenceLoaded || !targetLoaded) return;

        // 获取BPM值
        const bpm = parseFloat(bpmInput.value) || 120;
        beatInterval = 60 / bpm;

        // 如果模型尚未加载，先加载模型
        if (!referencePoseDetector || !targetPoseDetector) {
          similarityStatus.textContent = "正在加载模型...";
          await loadMoveNetModel();
        }

        comparisonRunning = true;
        startComparisonButton.disabled = false;
        stopComparisonButton.disabled = false;
        // startGameButton.disabled = false; // 启用开始游戏按钮
        similarityStatus.textContent = "正在比较中...";

        // 清空帧缓存
        referenceFrameBuffer = [];
        targetFrameBuffer = [];
        currentSecond = -1;

        // 清空上一次角度缓存
        lastReferenceAngles = {};
        lastTargetAngles = {};

        // 重置记录时间
        lastRecordedTime = 0;
        maxSimilarityInCurrentInterval = 0;

        // 同步播放两个视频

        referenceVideo.play();
        targetVideo.play();

        // 开始相似度分析
        startSimilarityAnalysis();
      });

      // 停止比较按钮
      stopComparisonButton.addEventListener("click", () => {
        comparisonRunning = false;
        startComparisonButton.disabled = false;
        stopComparisonButton.disabled = false;
        referenceVideo.pause();
        targetVideo.pause();
        similarityStatus.textContent = "比较已停止";

        // 如果正在使用摄像头，停止摄像头
        if (cameraStream) {
          stopCamera();
        }
      });

      // 开始游戏按钮
      startGameButton.addEventListener("click", () => {
        enterGameMode();
      });

      // 退出游戏按钮
      exitGameButton.addEventListener("click", () => {
        exitGameMode();
      });

      // 进入游戏模式
      function enterGameMode() {
        // 检查参考视频是否加载
        if (!referenceLoaded) {
          alert("请先加载参考视频！");
          return;
        }

        // 设置游戏模式标志
        gameModeRunning = true;

        // 显示游戏模式容器
        gameModeContainer.style.display = "block";

        // 复制参考视频源到游戏模式
        gameReferenceVideo.src = referenceVideo.src;

        // 检查对比视频是否加载，如果没有则使用摄像头
        if (!targetLoaded) {
          // 使用摄像头
          navigator.mediaDevices
            .getUserMedia({
              video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user",
              },
              audio: false,
            })
            .then((stream) => {
              gameTargetVideo.srcObject = stream;

              startGameCountdown();
            })
            .catch((err) => {
              console.error("无法访问摄像头:", err);
              alert("无法访问摄像头，请确保已授予摄像头权限");
              exitGameMode();
            });
        } else {
          // 复制对比视频源到游戏模式
          if (targetVideo.srcObject) {
            gameTargetVideo.srcObject = targetVideo.srcObject;
          } else {
            gameTargetVideo.src = targetVideo.src;
          }
          startGameCountdown();
        }
      }

      // 开始游戏倒计时
      function startGameCountdown() {
        // 显示倒计时
        let countdownValue = 3;
        countdownDisplay.style.display = "block";
        countdownDisplay.textContent = countdownValue;

        // 倒计时函数
        const countdownInterval = setInterval(() => {
          countdownValue--;
          if (countdownValue > 0) {
            countdownDisplay.textContent = countdownValue;
          } else {
            clearInterval(countdownInterval);
            countdownDisplay.style.display = "none";
            startSimilarityAnalysis();
            // 倒计时结束，开始播放视频并启动比较
            startGameComparison();
          }
        }, 1000);
      }

      // 开始游戏比较
      function startGameComparison() {
        // 同步播放状态
        gameReferenceVideo.play();
        gameTargetVideo.play();

        // 如果比较尚未运行，则启动比较
        if (!comparisonRunning) {
          // 重置分数相关变量
          totalScore = 120;
          scoresPerBeat = [];

          // 获取BPM值
          const bpm = parseFloat(bpmInput.value) || 120;
          beatInterval = 60 / bpm;

          // 重置记录时间
          lastRecordedTime = 0;
          maxSimilarityInCurrentInterval = 0;

          // 如果模型尚未加载，先加载模型
          if (!referencePoseDetector || !targetPoseDetector) {
            similarityStatus.textContent = "正在加载模型...";
            loadMoveNetModel().then(() => {
              comparisonRunning = true;
              similarityStatus.textContent = "正在比较中...";
              startSimilarityAnalysis();
            });
          } else {
            comparisonRunning = true;
            similarityStatus.textContent = "正在比较中...";
            startSimilarityAnalysis();
          }
        }
      }

      // 退出游戏模式
      function exitGameMode() {
        // 设置游戏模式标志
        gameModeRunning = false;

        // 隐藏游戏模式容器
        gameModeContainer.style.display = "none";

        // 暂停游戏视频
        gameReferenceVideo.pause();
        gameTargetVideo.pause();

        // 清除可能正在进行的倒计时
        const countdownElements = document.querySelectorAll("#countdown");
        countdownElements.forEach((element) => {
          element.style.display = "none";
        });
      }

      // 相似度分析
      async function startSimilarityAnalysis() {
        if (!comparisonRunning) return;

        // 获取当前秒数
        const refSecond = Math.floor(referenceVideo.currentTime);
        const targetSecond = Math.floor(targetVideo.currentTime);

        currentSecond = refSecond;

        // 清除画布
        referenceCtx.clearRect(
          0,
          0,
          referenceCanvas.width,
          referenceCanvas.height
        );
        targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

        // 绘制视频帧
        referenceCtx.drawImage(
          referenceVideo,
          0,
          0,
          referenceCanvas.width,
          referenceCanvas.height
        );
        targetCtx.drawImage(
          targetVideo,
          0,
          0,
          targetCanvas.width,
          targetCanvas.height
        );

        // 检测姿态
        const referenceKeypoints = await detectPose(
          referenceVideo,
          referenceCanvas,
          referenceCtx,
          referencePoseDetector
        );
        const targetKeypoints = await detectPose(
          targetVideo,
          targetCanvas,
          targetCtx,
          targetPoseDetector
        );

        if (referenceKeypoints.length > 0 && targetKeypoints.length > 0) {
          // 计算角度
          let referenceAngles = calculateAllAngles(referenceKeypoints);
          let targetAngles = calculateAllAngles(targetKeypoints);

          // 处理角度丢失的情况，使用上一次的角度
          for (const keypointName in KEYPOINT_PARENTS) {
            if (
              referenceAngles[keypointName] === null &&
              lastReferenceAngles[keypointName] !== undefined
            ) {
              referenceAngles[keypointName] = lastReferenceAngles[keypointName];
            } else if (referenceAngles[keypointName] !== null) {
              lastReferenceAngles[keypointName] = referenceAngles[keypointName];
            }

            if (
              targetAngles[keypointName] === null &&
              lastTargetAngles[keypointName] !== undefined
            ) {
              targetAngles[keypointName] = lastTargetAngles[keypointName];
            } else if (targetAngles[keypointName] !== null) {
              lastTargetAngles[keypointName] = targetAngles[keypointName];
            }
          }

          // 将帧数据添加到缓存中
          // 处理参考视频关键点置信度不足的情况
          // 为置信度不足的关键点使用上一次的值
          const processedRefKeypoints = referenceKeypoints.map((kp) => {
            // 如果当前关键点置信度不足，且存在上一次的记录，则使用上一次的值
            if (kp.score < 0.2 && lastReferenceKeypoints[kp.name]) {
              return lastReferenceKeypoints[kp.name];
            }
            return kp;
          });

          // 更新上一次关键点缓存（只记录置信度>0.2的点）
          referenceKeypoints.forEach((kp) => {
            if (kp.score > 0.2) {
              lastReferenceKeypoints[kp.name] = kp;
            }
          });

          // 计算参考视频肩膀距离
          let refShoulderDistance = 0;
          const refLeftShoulder = processedRefKeypoints.find(
            (kp) => kp.name === "left_shoulder"
          );
          const refRightShoulder = processedRefKeypoints.find(
            (kp) => kp.name === "right_shoulder"
          );

          if (
            refLeftShoulder &&
            refRightShoulder &&
            refLeftShoulder.score >= 0.2 &&
            refRightShoulder.score >= 0.2
          ) {
            refShoulderDistance = Math.hypot(
              refLeftShoulder.x - refRightShoulder.x,
              refLeftShoulder.y - refRightShoulder.y
            );
          }

          referenceFrameBuffer.push({
            time: referenceVideo.currentTime,
            keypoints: processedRefKeypoints,
            angles: referenceAngles,
            shoulderDistance: refShoulderDistance,
          });

          // 处理目标视频关键点置信度不足的情况
          // 为置信度不足的关键点使用上一次的值
          const processedTargetKeypoints = targetKeypoints.map((kp) => {
            // 如果当前关键点置信度不足，且存在上一次的记录，则使用上一次的值
            if (kp.score < 0.2 && lastTargetKeypoints[kp.name]) {
              return lastTargetKeypoints[kp.name];
            }
            return kp;
          });

          // 更新上一次关键点缓存（只记录置信度>0.2的点）
          targetKeypoints.forEach((kp) => {
            if (kp.score > 0.2) {
              lastTargetKeypoints[kp.name] = kp;
            }
          });

          // 计算目标视频肩膀距离
          let targetShoulderDistance = 0;
          const targetLeftShoulder = processedTargetKeypoints.find(
            (kp) => kp.name === "left_shoulder"
          );
          const targetRightShoulder = processedTargetKeypoints.find(
            (kp) => kp.name === "right_shoulder"
          );

          if (
            targetLeftShoulder &&
            targetRightShoulder &&
            targetLeftShoulder.score >= 0.2 &&
            targetRightShoulder.score >= 0.2
          ) {
            targetShoulderDistance = Math.hypot(
              targetLeftShoulder.x - targetRightShoulder.x,
              targetLeftShoulder.y - targetRightShoulder.y
            );
          }

          targetFrameBuffer.push({
            time: targetVideo.currentTime,
            keypoints: processedTargetKeypoints,
            angles: targetAngles,
            shoulderDistance: targetShoulderDistance,
          });

          // 维持滑动窗口大小
          if (referenceFrameBuffer.length > WINDOW_SIZE) {
            referenceFrameBuffer.shift();
          }

          if (targetFrameBuffer.length > WINDOW_SIZE) {
            targetFrameBuffer.shift();
          }

          // 当缓冲区足够时，进行滑动窗口比较

          const windowComparison = compareBufferFrames(
            referenceFrameBuffer,
            targetFrameBuffer
          );

          if (windowComparison.similarity) {
            // 显示 相似度
            const similarity = Math.floor(windowComparison.similarity);

            // 从第一拍后开始记录每拍的最高相似度
            if (referenceVideo.currentTime >= beatInterval) {
              // 更新当前间隔内的最高相似度
              if (similarity > maxSimilarityInCurrentInterval) {
                maxSimilarityInCurrentInterval = similarity;
              }

              // 每拍记录一次最高相似度
              if (
                referenceVideo.currentTime - lastRecordedTime >=
                beatInterval
              ) {
                scoresPerBeat.push(maxSimilarityInCurrentInterval * 1.2);
                lastRecordedTime = referenceVideo.currentTime;
                maxSimilarityInCurrentInterval = 0; // 重置当前间隔的最高相似度

                // 计算总分：所有记录的平均值
                if (scoresPerBeat.length > 0) {
                  const sum = scoresPerBeat.reduce((a, b) => a + b, 0);
                  totalScore = sum / scoresPerBeat.length;
                }

                // 更新总分显示
                document.getElementById("totalScoreValue").textContent =
                  totalScore.toFixed(2);
                document.getElementById("totalScoreDisplay").style.display =
                  "block";

                // 如果在游戏模式下，更新游戏分数显示
                if (gameModeRunning) {
                  gameScore.textContent = totalScore.toFixed(2);
                  currentWindowSimilarity.textContent = similarity;
                }
              }
            } else if (gameModeRunning) {
              // 游戏模式下显示当前窗口相似度，即使在第一拍之前
              currentWindowSimilarity.textContent = similarity;
            }

            // 显示窗口相似度
            windowSimilarity.textContent = `${similarity}%`;

            // 计算并显示上半身和下半身瞬间相似度
            if (
              windowComparison.referenceAngles &&
              windowComparison.targetAngles
            ) {
              const upperBodySim = Math.floor(
                calculateUpperBodySimilarity(
                  windowComparison.referenceAngles,
                  windowComparison.targetAngles
                )
              );
              const lowerBodySim = Math.floor(
                calculateLowerBodySimilarity(
                  windowComparison.referenceAngles,
                  windowComparison.targetAngles
                )
              );

              upperBodyInstantSimilarity.textContent = `${upperBodySim}%`;
              lowerBodyInstantSimilarity.textContent = `${lowerBodySim}%`;
            }

            // 显示角度差异对比
            const comparisonResult = windowComparison.comparison;
            if (comparisonResult) {
              comparisonAngleData.innerHTML = `
                                <div class="angle-item">有效关键点数: ${
                                  comparisonResult.validCount
                                }</div>
                                <div class="angle-item">平均角度差异: ${comparisonResult.averageDifference.toFixed(
                                  2
                                )}°</div>
                                <div class="angle-item">最高相似度: ${similarity}%</div>
                            `;
            }
          }

          // 在canvas上绘制关键点和角度
          drawKeypoints(referenceCtx, referenceKeypoints, referenceAngles);
          drawKeypoints(targetCtx, targetKeypoints, targetAngles);

          // 绘制1秒内的轨迹（只在参考视频中绘制ankle和wrist的轨迹）
          drawTrajectory(referenceCtx, referenceFrameBuffer, [
            "left_ankle",
            "right_ankle",
            "left_wrist",
            "right_wrist",
          ]);

          // 显示角度数据
          displayAngleData(referenceAngles, referenceAngleData);
          displayAngleData(targetAngles, targetAngleData);

          // 更新对比数据
          comparisonData.innerHTML = `
                    <p>参考视频时间: ${formatTime(
                      referenceVideo.currentTime
                    )}</p>
                    <p>对比视频时间: ${formatTime(targetVideo.currentTime)}</p>
                    <p>参考视频检测到关键点数量: ${
                      referenceKeypoints.filter((kp) => kp.score >= 0.2).length
                    }</p>
                    <p>对比视频检测到关键点数量: ${
                      targetKeypoints.filter((kp) => kp.score >= 0.2).length
                    }</p>
                    <p>参考视频缓存帧数: ${referenceFrameBuffer.length}</p>
                    <p>对比视频缓存帧数: ${targetFrameBuffer.length}</p>
                    <p>当前总分: ${totalScore.toFixed(2)}</p>
                    <p>每帧记录的帧数: ${scoresPerBeat.length}</p>
                `;
        } else {
          // 如果没有检测到关键点，显示提示信息
          referenceAngleData.innerHTML = "未检测到姿态";
          targetAngleData.innerHTML = "未检测到姿态";
        }

        // 继续下一帧分析
        if (comparisonRunning) {
          setTimeout(startSimilarityAnalysis, 10);
        }
      }

      // 页面加载完成初始化
      document.addEventListener("DOMContentLoaded", () => {
        // 初始化按钮状态
        referencePlayButton.disabled = false;
        referencePauseButton.disabled = false;
        referenceAnalyzeButton.disabled = false;

        targetPlayButton.disabled = false;
        targetPauseButton.disabled = false;
        targetAnalyzeButton.disabled = false;

        startComparisonButton.disabled = false;
        stopComparisonButton.disabled = false;
        startGameButton.disabled = true; // 初始禁用开始游戏按钮

        // 提前加载模型
        loadMoveNetModel();

        // BPM输入事件监听
        bpmInput.addEventListener("change", () => {
          const bpm = parseFloat(bpmInput.value) || 120;
          beatInterval = 60 / bpm;
        });

        // 向参考视频和对比视频容器添加轨迹提示
        const referenceWrapper =
          document.querySelector("#referenceCanvas").parentElement;
        if (referenceWrapper) {
          referenceWrapper.appendChild(trajectoryHint.cloneNode(true));
        }

        const targetWrapper =
          document.querySelector("#targetCanvas").parentElement;
        if (targetWrapper) {
          const targetHint = trajectoryHint.cloneNode(true);
          targetWrapper.appendChild(targetHint);
        }
      });
