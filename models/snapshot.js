const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  version: {
    type: String,
    required: true
  },
  build: {
    type: String
  },
  channel: {
    type: String
  }
});

const snapshotSchema = new mongoose.Schema({
  environmentName: {
    type: String,
    required: true
  },
  environmentType: {
    type: String,
    enum: ['Production', 'Preview'],
    required: true
  },
  packages: [packageSchema],
  rawText: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});


module.exports = mongoose.model('Snapshot', snapshotSchema);
