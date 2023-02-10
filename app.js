const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const app = express();

app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const checkPasswordLength = (password) => {
  const passwordLength = password.length;
  return passwordLength < 6;
};

const authenticateToken = (request, response, next) => {
  console.log("running");
  let jwtToken;
  //   const { authorization } = request.headers;
  //   console.log(typeof authorization);
  //   console.log(authorization.split(" "));
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "login", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        console.log(payload);
        request.username = payload.username;
        next();
      }
    });
  }
};

const getUserDetails = (username) => {
  return `select user_id as userId from user where username = '${username}'`;
  //return selectedUserQuery;
};

app.post("/register/", async (request, response) => {
  const userDetails = request.body;
  const { username, password, name, gender } = userDetails;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUser = `select * from user where username = '${username}'`;
  const checkUser = await db.get(getUser);
  if (checkUser === undefined) {
    if (checkPasswordLength(password)) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
        insert into user(username,password,name,gender)
        Values (
           '${username}',
            '${hashedPassword}',
            '${name}',
            '${gender}'
        );`;
      const dbResponse = await db.run(createUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectedUserQuery = `select * from user where username = '${username}';`;
  const loggedUser = await db.get(selectedUserQuery);
  console.log(loggedUser);
  if (loggedUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      loggedUser.password
    );
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "login");
      console.log(jwtToken);
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const username = request.username;
  const {
    offset = 0,
    limit = 4,
    search_q = "",
    order = "desc",
    order_by = "date_time",
  } = request.query;
  const { userId } = await db.get(getUserDetails(username));
  const selectedUserQuery = `select username, tweet ,date_time as dateTime from follower f inner join user u on  f.following_user_id = u.user_id inner join tweet t on f.following_user_id = t.user_id  where f.follower_user_id = ${userId} order by ${order_by} ${order} limit ${limit} ;`;
  const getFollowers = await db.all(selectedUserQuery);
  response.send(getFollowers);
  console.log(getFollowers);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const username = request.username;
  const { userId } = await db.get(getUserDetails(username));
  //   console.log(userId);
  //   console.log(await db.all(`select * from follower `));
  //   console.log(await db.all(`select user_id,name from user`));
  const selectedUserQuery = `select (select name from user where user_id = following_user_id) as name from follower f left join user u on f.follower_user_id = u.user_id where f.follower_user_id = ${userId};`;
  const getFollowers = await db.all(selectedUserQuery);
  response.send(getFollowers);
  console.log(getFollowers);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const username = request.username;
  const { userId } = await db.get(getUserDetails(username));
  const selectedUserQuery = `select (select name from user where user_id = follower_user_id) as name from follower f left join user u on f.following_user_id = u.user_id where f.following_user_id = ${userId};`;
  const getFollowers = await db.all(selectedUserQuery);
  response.send(getFollowers);
  //   console.log(getFollowers);
});

app.get("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const username = request.username;
  const { userId } = await db.get(getUserDetails(username));
  const { tweetId } = request.params;
  const userTweetIds = [];
  const checkingUserQuery = await db.all(
    `select following_user_id,tweet_id from follower f inner join tweet t on f.following_user_id = t.user_id where follower_user_id  = ${userId}`
  );
  for (let userTweet of checkingUserQuery) {
    userTweetIds.push(userTweet.tweet_id);
  }
  if (userTweetIds.includes(parseInt(tweetId)) === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const selectedUserQuery = `select t.tweet, (select count(like_id) from like where tweet_id = t.tweet_id) as likes,
  (select count(reply_id) from reply where tweet_id = t.tweet_id) as replies,t.date_time as dateTime
   from tweet t where t.tweet_id = ${tweetId}`;
    response.send(await db.get(selectedUserQuery));
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const username = request.username;
    const { userId } = await db.get(getUserDetails(username));
    const { tweetId } = request.params;
    const userTweetIds = [];
    const userTweetNames = [];
    const selectedUserQuery = await db.all(
      `select following_user_id,tweet_id from follower f inner join tweet t on f.following_user_id = t.user_id where follower_user_id  = ${userId}`
    );
    for (let userTweet of selectedUserQuery) {
      userTweetIds.push(userTweet.tweet_id);
    }
    if (userTweetIds.includes(parseInt(tweetId)) === false) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const likedUserId = await db.all(
        `select u.username from like l inner join user u on l.user_id = u.user_id where l.tweet_id  = ${tweetId}`
      );
      for (let likedUser of likedUserId) {
        userTweetNames.push(likedUser.username);
        console.log(likedUser.username);
      }
      response.send({
        likes: userTweetNames,
      });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies",
  authenticateToken,
  async (request, response) => {
    const username = request.username;
    const { userId } = await db.get(getUserDetails(username));
    const { tweetId } = request.params;
    const userTweetIds = [];
    const userTweetNames = [];
    const selectedUserQuery = await db.all(
      `select following_user_id,tweet_id from follower f inner join tweet t on f.following_user_id = t.user_id where follower_user_id  = ${userId}`
    );
    for (let userTweet of selectedUserQuery) {
      userTweetIds.push(userTweet.tweet_id);
    }
    if (userTweetIds.includes(parseInt(tweetId)) === false) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const repliedUsername = await db.all(
        `select u.name,r.reply from reply r inner join user u on r.user_id = u.user_id where r.tweet_id  = ${tweetId}`
      );
      for (let repliedUser of repliedUsername) {
        userTweetNames.push(repliedUser.name);
        console.log(repliedUser.name);
      }
      response.send({
        replies: repliedUsername,
      });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const { userId } = await db.get(getUserDetails(username));
  const selectedUserQuery = `select t.tweet, (select count(like_id) from like where tweet_id = t.tweet_id) as likes,
  (select count(reply_id) from reply where tweet_id = t.tweet_id) as replies,t.date_time as dateTime
   from tweet t where t.user_id = ${userId}`;
  const getTweets = await db.all(selectedUserQuery);
  console.log(getTweets);
  response.send(getTweets);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const username = request.username;
  const { userId } = await db.get(getUserDetails(username));
  console.log(tweet);
  const insertUserQuery = `insert into tweet (tweet,user_id) values ('${tweet}',${userId});`;
  const tweetAdded = await db.run(insertUserQuery);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const username = request.username;
  const { userId } = await db.get(getUserDetails(username));
  console.log(await db.all(`select * from tweet  where user_id = ${userId}`));
  const selectedUserQuery = `select * from tweet  where user_id = ${userId} and tweet_id = ${tweetId}`;
  const getTweet = await db.get(selectedUserQuery);
  if (getTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `delete from tweet where tweet_id = ${tweetId}`;
    const repliedUser = await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
