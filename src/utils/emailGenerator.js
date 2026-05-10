const axios = require('axios');
const CONSONANTS = 'bcdfghjklmnpqrstvwxyz';
const VOWELS = 'aeiou';

function generateUsername() {
  let username = '';
  for (let i = 0; i < 3; i++) {
    username += CONSONANTS.charAt(Math.floor(Math.random() * CONSONANTS.length));
    username += VOWELS.charAt(Math.floor(Math.random() * VOWELS.length));
  }
  const num = Math.floor(Math.random() * 90 + 10);
  return username + num;
}

function generateEmail(domain) {
  const username = generateUsername();
  return {
    username,
    email: username + '@' + domain,
    name: generateRandomName()
  };
}

function generateRandomName() {
  const firstNames = ['James', 'John', 'Robert', 'Michael', 'David', 'William', 'Richard', 'Joseph', 'Thomas', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Andrew', 'Paul', 'Joshua', 'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara', 'Elizabeth', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra', 'Ashley', 'Emily', 'Donna', 'Michelle', 'Dorothy', 'Carol', 'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia', 'Kathleen', 'Amy', 'Angela'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Phillips', 'Evans', 'Turner', 'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Cooper'];

  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  return first + " " + last;
}

function generateRandomBirthday() {
  const month = (Math.floor(Math.random() * 12) + 1).toString().padStart(2, '0');
  const day = (Math.floor(Math.random() * 28) + 1).toString().padStart(2, '0');
  const year = (Math.floor(Math.random() * 21) + 1980).toString();
  return {
    month,
    day,
    year,
    full: year + '-' + month + '-' + day
  };
}

async function createTempmailMailbox(baseUrl, domain) {
  const base = (baseUrl || 'https://tempmailzam.biz.id').replace(/\/$/, '');
  const username = generateUsername();
  const body = { mailbox: username };
  if (domain) body.domain = domain;
  const res = await axios.post(base + '/api/create', body, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 15000,
  });
  if (!res.data || !res.data.email || !res.data.mailbox_id) {
    throw new Error('TempMail Zam /api/create returned invalid response: ' + JSON.stringify(res.data));
  }
  return {
    username,
    email: res.data.email,
    mailboxId: res.data.mailbox_id,
    domain: res.data.domain || '',
    name: generateRandomName(),
  };
}

module.exports = { generateUsername, generateEmail, generateRandomName, generateRandomBirthday, createTempmailMailbox };
