

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

