const express = require('express');
const app = express();
const port = 3000;
const { check, validationResult } = require('express-validator');

// Database Details
const DB_USER = process.env['DB_USER'];
const DB_PWD = process.env['DB_PWD'];
const DB_URL = process.env['DB_URL'];
const DB_NAME = "task-lakshman";
const DB_COLLECTION_NAME = "players";
const playerData = require('./data/players.json');
const matchData = require('./data/match.json');

const { MongoClient, ServerApiVersion } = require('mongodb');
// const uri = "mongodb+srv://"+DB_USER+":"+DB_PWD+"@"+DB_URL+"/?retryWrites=true&w=majority";
// const uri = `mongodb://localhost:27017/${DB_NAME}`;
const uri = 'mongodb://127.0.0.1:27017';

// const client = new MongoClient(uri, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   }
// });
app.use(express.json());

const client = new MongoClient(uri);


let db;

async function run() {
  try {
    await client.connect();
    // await client.db("admin").command({ ping: 1 });

    db = client.db(DB_NAME);

    console.log("You successfully connected to MongoDB!");

  } finally {
  }
}


// Sample create document
async function sampleCreate() {
  const demo_doc = {
    "demo": "doc demo",
    "hello": "world"
  };
  const demo_create = await db.collection(DB_COLLECTION_NAME).insertOne(demo_doc);

  console.log("Added!")
  console.log(demo_create.insertedId);
}


// Endpoints


app.get('/', async (req, res) => {
  res.send('Hello World!');
});

app.get('/demo', async (req, res) => {
  await sampleCreate();
  res.send({ status: 1, message: "demo" });
});

const validateAddTeam = [
  check('teamName').notEmpty().withMessage('Team name is required'),
  check('players').isArray({ min: 11, max: 11 }).withMessage('Exactly 11 players are required'),
  check('captain').notEmpty().withMessage('Captain name is required'),
  check('viceCaptain').notEmpty().withMessage('Vice-captain name is required'),
];


app.post('/add-team', validateAddTeam, async (req, res) => {
  try {
    const { teamName, players, captain, viceCaptain } = req.body;

    if (!teamName || !players || !captain || !viceCaptain) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!Array.isArray(players) || players.length !== 11) {
      return res.status(400).json({ error: 'A team must have exactly 11 players' });
    }

    const rolesCount = {
      'BATTER': 0,
      'WICKETKEEPER': 0,
      'ALL-ROUNDER': 0,
      'BOWLER': 0
    };

    for (const player of players) {
      const playerDetails = playerData.find(p => p.Player === player);
      if (!playerDetails) {
        return res.status(400).json({ error: `Player ${player} not found` });
      }

      rolesCount[playerDetails.Role]++;
    }

    if (
      rolesCount['BATTER'] < 1 || rolesCount['BATTER'] > 8 ||
      rolesCount['WICKETKEEPER'] < 1 || rolesCount['WICKETKEEPER'] > 8 ||
      rolesCount['ALL-ROUNDER'] < 1 || rolesCount['ALL-ROUNDER'] > 8 ||
      rolesCount['BOWLER'] < 1 || rolesCount['BOWLER'] > 8
    ) {
      return res.status(400).json({ error: 'Invalid player roles or counts' });
    }


    if (!players.find(player => player === captain)) {
      return res.status(400).json({ error: 'Captain must be one of the selected players' });
    }

    if (!players.find(player => player === viceCaptain)) {
      return res.status(400).json({ error: 'Vice-captain must be one of the selected players' });
    }

    if (captain === viceCaptain) {
      return res.status(400).json({ error: 'Captain and vice-captain cannot be the same player' });
    }
    const playersWithNames = players.map(player => ({ name: player }));

    const collection = db.collection('teamEntries');

    const result = await collection.insertOne({
      teamName,
      players: playersWithNames,
      captain,
      viceCaptain,
      createdAt: new Date()
    });

    res.status(201).json({ message: 'Team entry added successfully', teamEntryId: result.insertedId });

  } catch (error) {
    console.error('Error occurred while adding team entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/process-result', async (req, res) => {
  try {

    const collection = db.collection('teamEntries');
    const teamEntries = await collection.find({}).toArray();

    for (const teamEntry of teamEntries) {
      const { players, captain, viceCaptain } = teamEntry;

      for (const player of players) {
        const points = await calculatePoints(player.name, matchData, captain, viceCaptain);
        player.points = points;
      }
      console.log(teamEntry.players, 'teamEntry.players');
      collection.updateOne({ _id: teamEntry._id }, { $set: { players: teamEntry.players } });
    }

    res.status(200).json({ message: 'Match results processed successfully' });

  } catch (error) {
    console.error('Error occurred while processing match result:', error);
    res.status(500).json({ error: 'Internal server error' });
  }

})

app.post('/team-result', async (req, res) => {
  try {
    const collection = db.collection('teamEntries');
    const teamEntries = await collection.find({}).toArray();

    teamEntries.forEach(team => {
      team.total_points = team.players.reduce((total, player) => total + player.points, 0);
    });

    const maxTotalPoints = Math.max(...teamEntries.map(team => team.total_points));

    const winningTeams = teamEntries.filter(team => team.total_points === maxTotalPoints);

    res.status(200).json({ teams: teamEntries, winningTeams: winningTeams });

  } catch (error) {
    console.error('Error occurred while team result:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
})

//calculate match process
async function calculatePoints(player, matchData, captain, viceCaptain) {
  console.log(player);
  let points = 0;
  for (const ball of matchData) {
    if (ball.batter === player || ball.bowler === player) {
      if (ball.batter === player) {
        points += ball.batsman_run; // Run
        if (ball.batsman_run === 4) points += 1; // Boundary Bonus
        if (ball.batsman_run === 6) points += 2; // Six Bonus
        if (ball.batsman_run >= 30) points += 4; // 30 Run Bonus
        if (ball.batsman_run >= 50) points += 8; // Half-century Bonus
        if (ball.batsman_run >= 100) points += 16; // Century Bonus
        if (ball.batsman_run === 0) points -= 2; // Dismissal for a duck
      }
      if (ball.bowler === player) {
        points += (ball.isWicketDelivery ? 25 : 0); // Wicket
        points += ((ball.kind === 'LBW' || ball.kind === 'Bowled') ? 8 : 0); // Bonus (LBW / Bowled)
        if (ball.isWicketDelivery && ball.player_out !== 'Run Out') {
          if (ball.kind === 'LBW' || ball.kind === 'Bowled') points += 8; // 3 Wicket Bonus
          if (ball.kind === 'LBW' || ball.kind === 'Bowled') points += 8; // 4 Wicket Bonus
          if (ball.kind === 'LBW' || ball.kind === 'Bowled') points += 8; // 5 Wicket Bonus
        }
        if (ball.extras_run === 0 && ball.total_run === 0) points += 12; // Maiden Over
      }
    }
    if (ball.fielders_involved === player) {
      if (ball.kind === 'caught') points += 8; // Catch
      if (ball.kind === 'caught' && ball.fielders_involved === 3) points += 4; // 3 Catch Bonus
      if (ball.kind === 'stumped') points += 12; // Stumping
      if (ball.kind === 'run out') points += 6; // Run out
    }
  }

  if (player === captain) {
    points *= 2; // Captain gets double points
  } else if (player === viceCaptain) {
    points *= 1.5; // Vice-captain gets 1.5 times points
  }
  console.log(points, player, '===========');
  return points;

}

//

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

run();