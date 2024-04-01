import { Injectable } from '@nestjs/common';
import { CreateLearnerProfileDto } from './dto/CreateLearnerProfile.dto';
import { ScoreSchema, ScoreDocument } from './schemas/scores.schema';
import { hexcodeMappingSchema, hexcodeMappingDocument } from './schemas/hexcodeMapping.schema';
import { assessmentInputSchema, assessmentInputDocument } from './schemas/assessmentInput.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Readable } from 'stream';
import { spawn } from 'child_process';

@Injectable()
export class ScoresService {
  constructor(
    @InjectModel('Score') private readonly scoreModel: Model<ScoreDocument>,
    @InjectModel('hexcodeMapping') private readonly hexcodeMappingModel: Model<hexcodeMappingDocument>,
    @InjectModel('assessmentInput') private readonly assessmentInputModel: Model<assessmentInputDocument>
  ) { }


  async create(createScoreDto: any): Promise<any> {
    try {
      const recordData = await this.scoreModel.find({ user_id: createScoreDto.user_id }).exec();
      if (recordData.length === 0) {
        const createdScore = new this.scoreModel(createScoreDto);
        const result = await createdScore.save();
        const updatedRecordData = this.scoreModel.updateOne(
          { 'user_id': createScoreDto.user_id },
          { $push: { "sessions": createScoreDto.session } },
        );
        return await updatedRecordData;
      } else {
        const updatedRecordData = this.scoreModel.updateOne(
          { 'user_id': createScoreDto.user_id },
          { $push: { "sessions": createScoreDto.session } },
        );
        return await updatedRecordData;
      }
    } catch (err) {
      return err;
    }
  }

  async createMilestoneRecord(createMilestoneRecord: any): Promise<any> {
    try {
      let insertData = {
        "session_id": createMilestoneRecord.session_id,
        "sub_session_id": createMilestoneRecord.sub_session_id,
        "milestone_level": createMilestoneRecord.milestone_level,
        "sub_milestone_level": createMilestoneRecord.sub_milestone_level,
        "createdAt": new Date().toISOString().replace('Z', '+00:00')
      }

      const updatedRecordData = await this.scoreModel.updateOne(
        { 'user_id': createMilestoneRecord.user_id },
        {
          $push: {
            "milestone_progress": insertData
          }
        }
      );

      return updatedRecordData;
    } catch (err) {
      return err;
    }
  }

  async audioFileToAsrOutput(data: any, language: String): Promise<any> {
    let asrOut: any;

    let serviceId = '';
    switch (language) {
      case "kn":
        serviceId = "ai4bharat/conformer-multilingual-dravidian--gpu-t4";
        break;
      case "ta":
        serviceId = "ai4bharat/conformer-multilingual-dravidian--gpu-t4";
        break;
      case "en":
        serviceId = "ai4bharat/whisper--gpu-t4";
        break;
      case "hi":
        serviceId = "ai4bharat/conformer-hi--gpu-t4";
        break;
      default:
        serviceId = `ai4bharat/conformer-${language}-gpu--t4`;
    }

    let optionsObj = {
      "config": {
        "serviceId": serviceId,
        "language": {
          "sourceLanguage": language
        },
        "audioFormat": "wav",
        "transcriptionFormat": {
          "value": "transcript"
        },
        "bestTokenCount": 2
      },
      "audio": [
        {
          "audioContent": data
        }
      ]
    }

    if (language === "en") {
      delete optionsObj.config.bestTokenCount
    }

    let options = JSON.stringify(optionsObj);

    let config = {
      method: 'post',
      url: process.env.AI4BHARAT_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.AI4BHARAT_API_KEY
      },
      data: options
    };

    await axios.request(config)
      .then((response) => {
        asrOut = response.data;
      })
      .catch((error) => {
        console.log(error);
      });

    return asrOut;
  }

  async findAll(): Promise<any> {
    const recordData = await this.scoreModel.find().exec();
    return recordData;
  }

  findOne(id: number) {
    return `This action returns a #${id} score`;
  }

  async findbySession(id: string) {
    const UserRecordData = await this.scoreModel.find({
      sessions:
      {
        $elemMatch:
        {
          session_id: id
        }
      }
    }).exec();
    return UserRecordData;
  }

  async getTargetsBySession(sessionId: string, language: string = null) {
    const threshold = 0.90
    const RecordData = await this.scoreModel.aggregate([
      {
        $unwind: '$sessions'
      },
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $unwind: '$sessions.confidence_scores'
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          date: '$sessions.date',
          session_id: '$sessions.session_id',
          language: '$sessions.language',
          character: '$sessions.confidence_scores.token',
          score: '$sessions.confidence_scores.confidence_score'
        }
      }
    ]);

    const MissingRecordData = await this.scoreModel.aggregate([
      {
        $unwind: '$sessions'
      },
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $unwind: '$sessions.missing_token_scores'
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          date: '$sessions.date',
          session_id: '$sessions.session_id',
          language: '$sessions.language',
          character: '$sessions.missing_token_scores.token',
          score: '$sessions.missing_token_scores.confidence_score'
        }
      }
    ]);

    let charScoreData = [];

    let uniqueChar = new Set();


    for (let RecordDataele of RecordData) {
      if (language != null && RecordDataele.language === language) {
        uniqueChar.add(RecordDataele.character)
      } else if (language === null) {
        uniqueChar.add(RecordDataele.character)
      }
    };

    for (let char of uniqueChar) {
      let score = 0;
      let count = 0;
      for (let checkRecordDataele of RecordData) {
        if (char === checkRecordDataele.character && checkRecordDataele.score >= score) {
          score += checkRecordDataele.score;
          count++;
        }
      }
      let avgScore = score / count;
      if (avgScore < 0.90 && count > 0) {
        charScoreData.push({ character: char, score: avgScore });
      }
    }


    let missingUniqueChar = new Set();

    for (let MissingRecordDataEle of MissingRecordData) {
      if (!uniqueChar.has(MissingRecordDataEle.character) && !missingUniqueChar.has(MissingRecordDataEle.character) && language != null && MissingRecordDataEle.language === language) {
        charScoreData.push({ character: MissingRecordDataEle.character, score: MissingRecordDataEle.score });
        missingUniqueChar.add(MissingRecordDataEle.character)
      } else if (!uniqueChar.has(MissingRecordDataEle.character) && !missingUniqueChar.has(MissingRecordDataEle.character)) {
        charScoreData.push({ character: MissingRecordDataEle.character, score: MissingRecordDataEle.score });
        missingUniqueChar.add(MissingRecordDataEle.character)
      }
    }

    return charScoreData.sort((a, b) => a.score - b.score);
  }

  async getTargetsBysubSession(subSessionId: string, contentType: string, language: string) {
    let threshold = 0.90;

    if (contentType != null && contentType.toLowerCase() === 'word') {
      threshold = 0.75
    }

    const RecordData = await this.scoreModel.aggregate([
      {
        $unwind: '$sessions'
      },
      {
        $match: {
          'sessions.sub_session_id': subSessionId,
          'sessions.language': language
        }
      },
      {
        $facet: {
          confidenceScores: [
            {
              $unwind: '$sessions.confidence_scores'
            },
            {
              $project: {
                _id: 0,
                user_id: 1,
                date: '$sessions.createdAt',
                session_id: '$sessions.session_id',
                character: '$sessions.confidence_scores.token',
                score: '$sessions.confidence_scores.confidence_score',
              }
            },
            {
              $sort: {
                date: -1
              }
            }
          ],
          missingTokenScores: [
            {
              $unwind: '$sessions.missing_token_scores'
            },
            {
              $project: {
                _id: 0,
                user_id: 1,
                session_id: '$sessions.session_id',
                date: '$sessions.createdAt',
                character: '$sessions.missing_token_scores.token',
                score: '$sessions.missing_token_scores.confidence_score'
              }
            },
            {
              $sort: {
                date: -1
              }
            }
          ]
        }
      },
      {
        $project: {
          combinedResults: {
            $concatArrays: ['$confidenceScores', '$missingTokenScores']
          }
        }
      },
      {
        $unwind: '$combinedResults'
      },
      {
        $replaceRoot: {
          newRoot: '$combinedResults'
        }
      },
      {
        $project: {
          user_id: "$user_id",
          sessionId: '$session_id',
          date: '$date',
          token: '$character',
          score: '$score'
        }
      },
      {
        $sort: {
          date: -1
        }
      },
      {
        $group: {
          _id: {
            token: "$token",
            userId: "$user_id",
            sessionId: "$sessionId"
          },
          meanScore: { $avg: "$score" }
        }
      },
      {
        $project: {
          _id: 0,
          user_id: "$_id.userId",
          session_id: "$_id.sessionId",
          character: "$_id.token",
          score: "$meanScore"
        }
      },
      {
        $match: {
          'score': { $lt: threshold }
        }
      },
      {
        $sort: {
          score: 1
        }
      }
    ]);

    return RecordData.sort((a, b) => a.score - b.score);
  }

  async getTargetsByUser(userId: string, language: string = null) {
    const threshold = 0.90;

    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'user_id': userId
        }
      },
      {
        $unwind: '$sessions'
      },
      {
        $match: {
          'sessions.language': language
        }
      },
      {
        $facet: {
          confidenceScores: [
            {
              $unwind: '$sessions.confidence_scores'
            },
            {
              $project: {
                _id: 0,
                user_id: 1,
                date: '$sessions.createdAt',
                character: '$sessions.confidence_scores.token',
                score: '$sessions.confidence_scores.confidence_score',
              }
            },
            {
              $sort: {
                date: -1
              }
            }
          ],
          missingTokenScores: [
            {
              $unwind: '$sessions.missing_token_scores'
            },
            {
              $project: {
                _id: 0,
                user_id: 1,
                date: '$sessions.createdAt',
                character: '$sessions.missing_token_scores.token',
                score: '$sessions.missing_token_scores.confidence_score'
              }
            },
            {
              $sort: {
                date: -1
              }
            }
          ]
        }
      },
      {
        $project: {
          combinedResults: {
            $concatArrays: ['$confidenceScores', '$missingTokenScores']
          }
        }
      },
      {
        $unwind: '$combinedResults'
      },
      {
        $replaceRoot: {
          newRoot: '$combinedResults'
        }
      },
      {
        $project: {
          user_id: "$user_id",
          sessionId: '$session_id',
          date: '$date',
          token: '$character',
          score: '$score'
        }
      },
      {
        $sort: {
          date: -1
        }
      },
      {
        $group: {
          _id: {
            token: "$token",
            userId: "$user_id"
          },
          meanScore: { $avg: "$score" }
        }
      },
      {
        $project: {
          _id: 0,
          user_id: "$_id.userId",
          session_id: "$_id.sessionId",
          character: "$_id.token",
          score: "$meanScore"
        }
      },
      {
        $match: {
          'score': { $lt: threshold }
        }
      },
      {
        $sort: {
          score: 1
        }
      }
    ]);

    return RecordData.sort((a, b) => a.score - b.score);
  }

  async getFamiliarityBySession(sessionId: string) {
    const threshold = 0.90
    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $unwind: '$sessions'
      },
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $unwind: '$sessions.confidence_scores'
      },
      // {
      //   $match: {
      //     'sessions.confidence_scores.confidence_score': { $gte: threshold }
      //   }
      // },
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $project: {
          _id: 0,
          character: '$sessions.confidence_scores.token',
          score: '$sessions.confidence_scores.confidence_score'
        }
      }
    ]);
    let charScoreData = [];

    let uniqueChar = new Set();

    for (let RecordDataele of RecordData) { uniqueChar.add(RecordDataele.character) };


    for (let char of uniqueChar) {
      let score = 0;
      let count = 0;
      for (let checkRecordDataele of RecordData) {
        if (char === checkRecordDataele.character && checkRecordDataele.score >= score) {
          score += checkRecordDataele.score;
          count++;
        }
      }

      let avgScore = score / count;
      if (avgScore >= 0.90) {
        charScoreData.push({ character: char, score: score });
      }
    }

    return charScoreData.sort((a, b) => a.score - b.score);
  }

  async getFamiliarityBysubSession(subSessionId: string, contentType: string, language: string) {
    let threshold = 0.90;

    if (contentType != null && contentType.toLowerCase() === 'word') {
      threshold = 0.75
    }

    const RecordData = await this.scoreModel.aggregate([
      {
        $unwind: '$sessions'
      },
      {
        $match: {
          'sessions.sub_session_id': subSessionId,
          'sessions.language': language
        }
      },
      {
        $facet: {
          confidenceScores: [
            {
              $unwind: '$sessions.confidence_scores'
            },
            {
              $project: {
                _id: 0,
                user_id: 1,
                date: '$sessions.createdAt',
                session_id: '$sessions.session_id',
                character: '$sessions.confidence_scores.token',
                score: '$sessions.confidence_scores.confidence_score',
              }
            },
            {
              $sort: {
                date: -1
              }
            }
          ],
          missingTokenScores: [
            {
              $unwind: '$sessions.missing_token_scores'
            },
            {
              $project: {
                _id: 0,
                user_id: 1,
                session_id: '$sessions.session_id',
                date: '$sessions.createdAt',
                character: '$sessions.missing_token_scores.token',
                score: '$sessions.missing_token_scores.confidence_score'
              }
            },
            {
              $sort: {
                date: -1
              }
            }
          ]
        }
      },
      {
        $project: {
          combinedResults: {
            $concatArrays: ['$confidenceScores', '$missingTokenScores']
          }
        }
      },
      {
        $unwind: '$combinedResults'
      },
      {
        $replaceRoot: {
          newRoot: '$combinedResults'
        }
      },
      {
        $project: {
          user_id: "$user_id",
          sessionId: '$session_id',
          date: '$date',
          token: '$character',
          score: '$score'
        }
      },
      {
        $sort: {
          date: -1
        }
      },
      {
        $group: {
          _id: {
            token: "$token",
            userId: "$user_id",
            sessionId: "$sessionId"
          },
          meanScore: { $avg: "$score" }
        }
      },
      {
        $project: {
          _id: 0,
          user_id: "$_id.userId",
          session_id: "$_id.sessionId",
          character: "$_id.token",
          score: "$meanScore"
        }
      },
      {
        $match: {
          'score': { $gte: threshold }
        }
      },
      {
        $sort: {
          score: 1
        }
      }
    ]);

    return RecordData.sort((a, b) => a.score - b.score);
  }

  async getFamiliarityByUser(userId: string) {
    const threshold = 0.90
    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'user_id': userId
        }
      },
      {
        $unwind: '$sessions'
      },
      {
        $unwind: '$sessions.confidence_scores'
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          date: '$sessions.date',
          character: '$sessions.confidence_scores.token',
          score: '$sessions.confidence_scores.confidence_score'
        }
      }
    ]);
    let charScoreData = [];

    let uniqueChar = new Set();

    for (let RecordDataele of RecordData) { uniqueChar.add(RecordDataele.character) };


    for (let char of uniqueChar) {
      let score = 0;
      let count = 0;

      for (let checkRecordDataele of RecordData) {
        if (char === checkRecordDataele.character && checkRecordDataele.score >= score) {
          score += checkRecordDataele.score;
          count++;
        }
      }

      let avgScore = score / count;
      if (avgScore >= 0.90) {
        charScoreData.push({ character: char, score: score });
      }
    }

    return charScoreData.sort((a, b) => a.score - b.score);
  }

  async getFluencyBysubSession(subSessionId: string, language: string) {

    const RecordData = await this.scoreModel.aggregate([
      {
        $unwind: "$sessions"
      },
      {
        $match: {
          'sessions.sub_session_id': subSessionId,
          'sessions.language': language
        }
      },
      {
        $group: {
          _id: {
            subSessionId: "$sessions.sub_session_id",
          },
          fluencyScore: { $avg: "$sessions.fluencyScore" }
        }
      },
      {
        $project: {
          _id: 0,
          fluencyScore: "$fluencyScore"
        }
      }
    ]);

    return RecordData[0]?.fluencyScore;
  }

  async findbyUser(id: string) {
    const UserRecordData = await this.scoreModel.find({ user_id: id }).exec();
    return UserRecordData;
  }

  async gethexcodeMapping(language: String) {
    const recordData = await this.hexcodeMappingModel.find({ language: language }).exec();
    return recordData;
  }

  async getMeanLearnerBySession(sessionId: string) {
    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $unwind: '$sessions'
      },
      {
        $unwind: '$sessions.confidence_scores'
      },
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          session_id: '$sessions.session_id',
          token: '$sessions.confidence_scores.token',
          score: '$sessions.confidence_scores.confidence_score',
          hexcode: '$sessions.confidence_scores.hexcode',
        }
      },
      {
        $group: {
          _id: {
            user_id: '$user_id',
            token: '$token'
          },
          mean: { $avg: '$score' }
        }
      },
      {
        $project: {
          _id: 0,
          token: '$_id.token',
          mean: 1
        }
      }
    ]
    );
    return RecordData;
  }

  async getlatestmilestone(userId: string, language: string) {
    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'user_id': userId
        }
      },
      {
        $unwind: '$milestone_progress'
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          session_id: '$milestone_progress.session_id',
          sub_session_id: '$milestone_progress.sub_session_id',
          milestone_level: '$milestone_progress.milestone_level',
          sub_milestone_level: '$milestone_progress.sub_milestone_level',
          createdAt: '$milestone_progress.createdAt',
          sessions: 1
        }
      },
      {
        $addFields: {
          language: {
            $let: {
              vars: {
                matchedSession: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$sessions',
                        as: 'session',
                        cond: {
                          $eq: ['$$session.sub_session_id', '$sub_session_id']
                        }
                      }
                    },
                    0
                  ]
                }
              },
              in: '$$matchedSession.language'
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          session_id: 1,
          sub_session_id: 1,
          milestone_level: 1,
          sub_milestone_level: 1,
          createdAt: 1,
          language: 1
        }
      },
      {
        $match: {
          'language': language
        }
      },
      {
        $sort: {
          createdAt: -1
        }
      }
    ]
    ).limit(1);
    return RecordData;
  }

  async getMeanLearnerByUser(userId: string) {
    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'user_id': userId
        }
      },
      {
        $unwind: '$sessions'
      },
      {
        $unwind: '$sessions.confidence_scores'
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          session_id: '$sessions.session_id',
          token: '$sessions.confidence_scores.token',
          score: '$sessions.confidence_scores.confidence_score',
          hexcode: '$sessions.confidence_scores.hexcode',
        }
      },
      {
        $group: {
          _id: {
            user_id: '$user_id',
            token: '$token'
          },
          mean: { $avg: '$score' }
        }
      },
      {
        $project: {
          _id: 0,
          token: '$_id.token',
          mean: 1
        }
      }
    ]
    );
    return RecordData;
  }

  async getConfidentVectorByUser(userId: string) {
    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'user_id': userId
        }
      },
      {
        $unwind: '$sessions'
      },
      {
        $unwind: '$sessions.confidence_scores'
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          token: '$sessions.confidence_scores.token',
          score: '$sessions.confidence_scores.confidence_score'
        }
      },
      {
        $group: {
          _id: {
            user_id: '$user_id',
            token: '$token'
          },
          scores: { $push: '$score' }
        }
      },
      {
        $project: {
          _id: 0,
          user_id: '$_id.user_id',
          token: '$_id.token',
          count: { $size: '$scores' },
          score:
          {
            $sortArray:
            {
              input: '$scores',
              sortBy: 1
            }
          }
        }
      },
      {
        $project: {
          token: 1,
          // score: 1,
          median: {
            $cond: {
              if: { $eq: ['$count', 0] },
              then: null,
              else: {
                $cond: {
                  if: { $eq: [{ $mod: ['$count', 2] }, 1] },
                  then: { $arrayElemAt: ['$score', { $floor: { $divide: ['$count', 2] } }] },
                  else: {
                    $avg: [
                      { $arrayElemAt: ['$score', { $subtract: [{ $round: { $divide: ['$count', 2] } }, 1] }] },
                      { $arrayElemAt: ['$score', { $divide: ['$count', 2] }] }
                    ]
                  }
                }
              }
            }
          }
        }
      }
    ]
    );
    return RecordData;
  }

  async getConfidentVectorBySession(sessionId: string) {
    const RecordData = await this.scoreModel.aggregate([
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $unwind: '$sessions'
      },
      {
        $unwind: '$sessions.confidence_scores'
      },
      {
        $match: {
          'sessions.session_id': sessionId
        }
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          token: '$sessions.confidence_scores.token',
          score: '$sessions.confidence_scores.confidence_score'
        }
      },
      {
        $group: {
          _id: {
            user_id: '$user_id',
            token: '$token'
          },
          scores: { $push: '$score' }
        }
      },
      {
        $project: {
          _id: 0,
          user_id: '$_id.user_id',
          token: '$_id.token',
          count: { $size: '$scores' },
          score:
          {
            $sortArray:
            {
              input: '$scores',
              sortBy: 1
            }
          }
        }
      },
      {
        $project: {
          token: 1,
          // score: 1,
          median: {
            $cond: {
              if: { $eq: ['$count', 0] },
              then: null,
              else: {
                $cond: {
                  if: { $eq: [{ $mod: ['$count', 2] }, 1] },
                  then: { $arrayElemAt: ['$score', { $floor: { $divide: ['$count', 2] } }] },
                  else: {
                    $avg: [
                      { $arrayElemAt: ['$score', { $subtract: [{ $round: { $divide: ['$count', 2] } }, 1] }] },
                      { $arrayElemAt: ['$score', { $divide: ['$count', 2] }] }
                    ]
                  }
                }
              }
            }
          }
        }
      }
    ]
    );
    return RecordData;
  }

  async getMissingChars(language: string) {
    const RecordData = await this.hexcodeMappingModel.find({
      'language': language
    }, { 'token': 1, '_id': 0 }).exec();
    console.log(RecordData);
    let tokenArray = RecordData.map((data) => {
      return data.token;
    })
    return tokenArray;
  }

  async assessmentInputCreate(assessmentInputData: any): Promise<any> {
    try {

      const assessmentInput = this.assessmentInputModel.updateMany(
        { user_id: assessmentInputData.user_id, session_id: assessmentInputData.session_id, token: assessmentInputData.token },
        { $set: { feedback: assessmentInputData.feedback } },
        { new: true, upsert: true }
      );

      return await assessmentInput;
    } catch (err) {
      return err;
    }
  }

  async getAssessmentRecords(sessionId: string): Promise<any> {
    try {
      const AssessmentRecords = await this.assessmentInputModel.aggregate([
        {
          $match: {
            session_id: sessionId
          }
        },
        {
          $group: {
            _id: {
              session_id: sessionId,
              token: "$token"
            },
            feedback: { $max: "$feedback" }
          }
        },
        {
          $match: {
            feedback: 0
          }
        },
        {
          $project: {
            _id: 0,
            session_id: "$_id.session_id",
            token: "$_id.token",
            feedback: 1
          }
        }
      ]);

      return AssessmentRecords;
    } catch (err) {
      return err;
    }
  }

  async getAssessmentRecordsUserid(userId: string): Promise<any> {
    try {
      const AssessmentRecords = await this.assessmentInputModel.aggregate([
        {
          $match: {
            user_id: userId
          }
        },
        {
          $group: {
            _id: {
              user_id: userId,
              token: "$token"
            },
            feedback: { $max: "$feedback" }
          }
        },
        {
          $match: {
            feedback: 0
          }
        },
        {
          $project: {
            _id: 0,
            user_id: "$_id.user_id",
            token: "$_id.token",
            feedback: 1
          }
        }
      ]);

      return AssessmentRecords;
    } catch (err) {
      return err;
    }
  }

  async getAllSessions(userId: string, limit: number, calculateMilestone: boolean = false) {
    const RecordData = await this.scoreModel.aggregate([
      {
        "$match": {
          "user_id": userId
        }
      },
      {
        "$unwind": '$sessions'
      },
      {
        "$project": {
          "_id": 0,
          "user_id": 1,
          "date": '$sessions.createdAt',
          "session_id": '$sessions.session_id'
        }
      },
      {
        "$group": {
          "_id": "$session_id",
          "user_id": { "$first": "$user_id" },
          "date": { "$first": "$date" },
          "totalrecords": { "$count": {} }
        }
      },
      {
        "$sort": {
          "_id": -1
        }
      },
      {
        "$project": {
          "_id": 0,
          "session_id": "$_id",
          "totalrecords": "$totalrecords"
        }
      }
    ]).limit(Number(limit));



    const sessionIds = RecordData.map(item => {
      if (calculateMilestone && item.totalrecords < 3) {

      } else if (!calculateMilestone) {
        return item.session_id
      } else {
        return item.session_id
      }
    }).filter((sessionIdEle) => sessionIdEle != undefined)

    return sessionIds;
  }

  async denoiserService(base64Data: any): Promise<any> {
    try {

      // Convert base64 string to buffer
      const buffer = Buffer.from(base64Data, 'base64');

      // Create a readable stream from the buffer
      const inputStream = new Readable();
      inputStream.push(buffer);
      inputStream.push(null); // Indicates the end of the stream

      //var base64String;

      // Spawn ffmpeg process
      const ffmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0', // Input from stdin
        '-f', 'wav', // Specify input format
        '-filter_complex', 'highpass=f=300,asendcmd=0.3 afftdn sn start,asendcmd=0.8 afftdn sn stop,afftdn=nf=-20,dialoguenhance,lowpass=f=1000', // Audio filters
        '-f', 'wav', // Specify output format
        'pipe:1', // Output to stdout
      ]);

      // Pipe input stream to ffmpeg stdin
      inputStream.pipe(ffmpegProcess.stdin);

      return new Promise<string>((resolve, reject) => {
        let base64Output = '';
        // Capture ffmpeg stdout
        ffmpegProcess.stdout.on('data', (data) => {
          base64Output += data.toString('base64');
        });

        // Handle ffmpeg process end
        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            resolve(base64Output);
          } else {
            reject(new Error(`FFmpeg process exited with code ${code}`));
          }
        });

        // Handle errors
        ffmpegProcess.on('error', (err) => {
          reject(err);
        });
      });

      // Create a pass-through stream to capture ffmpeg output
      // const outputBuffers = [];
      // const writableStream = new PassThrough();
      // writableStream.on('data', (chunk) => outputBuffers.push(chunk));

      // // Build the ffmpeg command
      // await FfmpegCommand()
      //   .input(inputStream)
      //   .inputFormat('wav') // Specify input format explicitly if necessary
      //   .audioFilters([
      //     'highpass=f=300',
      //     'asendcmd=0.3 afftdn sn start',
      //     'asendcmd=0.8 afftdn sn stop',
      //     'afftdn=nf=-20',
      //     'dialoguenhance',
      //     'lowpass=f=1000'
      //   ])
      //   .toFormat('wav') // Ensure output format is WAV
      //   .pipe(writableStream) // Pipe the output to the pass-through stream
      //   .on('end', () => {
      //     console.log('Processing finished successfully');

      //     writableStream.on('end', () => {
      //       const convertedBuffer = Buffer.concat(outputBuffers);
      //       const base64String = base64js.fromByteArray(convertedBuffer);
      //       //console.log(base64String);
      //       console.log("hello");
      //       return base64String;
      //     });

      //     // Convert the captured output to base64
      //     // const base64Output = Buffer.concat(writableStream.read()).toString('base64');
      //     // console.log('Base64 output:', base64Output);

      //   })
      //   .on('error', (err) => {
      //     console.error('Error during processing:', err);
      //   })
      // .run();

    } catch (err) {
      return err;
    }
  }
}
