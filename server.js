const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const csv = require('csv-parser');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup
app.use(session({
    secret: 'supersecretkey',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// File upload setup for CSV
const upload = multer({ dest: 'uploads/' });

// Database setup
const db = new sqlite3.Database('event.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS attendees (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            name TEXT,
            email TEXT,
            phone TEXT,
            role TEXT,
            qr_code TEXT,
            nft_token_id TEXT,
            registered INTEGER,
            lunch_received INTEGER,
            swags_received INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            name TEXT,
            date TEXT,
            time TEXT,
            location TEXT,
            description TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            event_id TEXT,
            title TEXT,
            time TEXT,
            location TEXT,
            description TEXT,
            FOREIGN KEY(event_id) REFERENCES events(id)
        )`);

        db.get("SELECT id FROM events WHERE id = 'event1'", (err, row) => {
            if (!row) {
                db.run(`INSERT INTO events (id, name, date, time, location, description) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['event1', 'Safety First 2024', 'May 15, 2025', '9:00 AM - 5:00 PM', 'Convention Center, Hall A', 'Join us for a day of innovation, networking, and learning at Safety First 2024!']);
            }
        });

        db.get("SELECT id FROM sessions WHERE event_id = 'event1'", (err, row) => {
            if (!row) {
                const sessions = [
                    ['session1', 'event1', 'Opening Keynote: The Future of Tech', '9:00 AM - 10:00 AM', 'Main Stage', 'A keynote address by industry leaders on emerging technologies.'],
                    ['session2', 'event1', 'Workshop: AI in Everyday Life', '10:30 AM - 12:00 PM', 'Room 101', 'Hands-on workshop exploring AI applications.'],
                    ['session3', 'event1', 'Lunch Break', '12:00 PM - 1:30 PM', 'Dining Hall', 'Enjoy a networking lunch with fellow attendees.'],
                    ['session4', 'event1', 'Panel Discussion: Sustainable Tech', '1:30 PM - 3:00 PM', 'Main Stage', 'Experts discuss sustainability in technology.'],
                    ['session5', 'event1', 'Closing Ceremony', '4:00 PM - 5:00 PM', 'Main Stage', 'Wrap-up and awards ceremony.']
                ];
                sessions.forEach(session => {
                    db.run(`INSERT INTO sessions (id, event_id, title, time, location, description) VALUES (?, ?, ?, ?, ?, ?)`, session);
                });
            }
        });
    }
});

// Simulate NFC enabled/disabled state
let nfcEnabled = false;

// EmailJS configuration (replace with your actual EmailJS credentials)
const EMAILJS_SERVICE_ID = 'your_service_id'; // Replace with your actual Service ID
const EMAILJS_TEMPLATE_ID = 'your_template_id'; // Replace with your actual Template ID
const EMAILJS_PUBLIC_KEY = 'your_public_key'; // Replace with your actual Public Key

const sendEmail = async (toEmail, username, password) => {
    const templateParams = {
        to_email: toEmail,
        username: username,
        password: password,
        login_url: 'http://localhost:3000/attendee_login'
    };

    try {
        const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                service_id: EMAILJS_SERVICE_ID,
                template_id: EMAILJS_TEMPLATE_ID,
                user_id: EMAILJS_PUBLIC_KEY,
                template_params: templateParams
            })
        });

        const responseBody = await response.text(); // Get the response body for detailed error info
        if (response.ok) {
            console.log(`Email sent successfully to ${toEmail} with credentials`);
            return true;
        } else {
            console.error(`Failed to send email to ${toEmail}. Status: ${response.status}, Response: ${responseBody}`);
            return false;
        }
    } catch (err) {
        console.error(`Error sending email to ${toEmail}:`, err.message);
        return false;
    }
};

// Generate attendee ID based on name
const generateAttendeeId = async (name) => {
    let baseId = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!baseId) {
        baseId = 'attendee';
    }

    let uniqueId = baseId;
    let counter = 1;

    while (true) {
        const existingAttendee = await new Promise((resolve, reject) => {
            db.get("SELECT id FROM attendees WHERE id = ?", [uniqueId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        if (!existingAttendee) break;
        uniqueId = `${baseId}_${counter}`;
        counter++;
    }

    return uniqueId;
};

// Generate QR code
const generateQR = async (attendeeId) => {
    const qrPath = path.join(__dirname, 'public', 'qr_codes', `${attendeeId}.png`);
    try {
        await QRCode.toFile(qrPath, attendeeId, {
            color: { dark: '#000', light: '#FFF' },
            margin: 4,
            width: 200
        });
        console.log(`QR code generated for attendee ${attendeeId}`);
        return `qr_codes/${attendeeId}.png`;
    } catch (err) {
        console.error(`Error generating QR code: ${err}`);
        throw err;
    }
};

// Simulate NFT token generation (mock blockchain)
const generateNFTToken = (attendeeId) => {
    return `NFT-${attendeeId}-${Date.now()}`;
};

// Middleware for role-based access
const loginRequired = (role) => (req, res, next) => {
    if (!req.session.userId) {
        req.session.flash = { type: 'error', message: 'Please log in to access this page.' };
        return res.redirect(role === 'organizer' ? '/organizer_login' : '/attendee_login');
    }
    if (req.session.role !== role) {
        req.session.flash = { type: 'error', message: 'You do not have permission to access this page.' };
        return res.redirect(req.session.role === 'organizer' ? '/organizer_login' : '/attendee_login');
    }
    next();
};

// Flash messages helper
const getFlashMessages = (req) => {
    const flash = req.session.flash || [];
    req.session.flash = null;
    return Array.isArray(flash) ? flash : [flash];
};

// Routes

app.get('/', (req, res) => {
    res.redirect('/organizer_login');
});

app.get('/organizer_login', (req, res) => {
    res.render('organizer_login', { messages: getFlashMessages(req) });
});

app.post('/organizer_login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT id, role FROM users WHERE username = ? AND password = ? AND role = 'organizer'", [username, password], (err, user) => {
        if (err) {
            console.error('Database error during organizer login:', err);
            req.session.flash = { type: 'error', message: 'An error occurred. Please try again.' };
            return res.redirect('/organizer_login');
        }
        if (user) {
            req.session.userId = user.id;
            req.session.role = user.role;
            console.log(`Organizer login successful: user_id=${user.id}`);
            return res.redirect('/organizer/dashboard');
        }
        req.session.flash = { type: 'error', message: 'Invalid credentials for organizer.' };
        res.redirect('/organizer_login');
    });
});

app.get('/attendee_login', (req, res) => {
    res.render('attendee_login', { messages: getFlashMessages(req) });
});

app.post('/attendee_login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT id, role FROM users WHERE username = ? AND password = ? AND role = 'attendee'", [username, password], (err, user) => {
        if (err) {
            console.error('Database error during attendee login:', err);
            req.session.flash = { type: 'error', message: 'An error occurred. Please try again.' };
            return res.redirect('/attendee_login');
        }
        if (user) {
            req.session.userId = user.id;
            req.session.role = user.role;
            console.log(`Attendee login successful: user_id=${user.id}`);
            return res.redirect('/attendee/events');
        }
        req.session.flash = { type: 'error', message: 'Invalid credentials for attendee.' };
        res.redirect('/attendee_login');
    });
});

app.get('/logout', (req, res) => {
    const userId = req.session.userId;
    req.session.destroy(() => {
        console.log(`User logged out: user_id=${userId}`);
        res.redirect('/organizer_login');
    });
});

app.get('/organizer/dashboard', loginRequired('organizer'), (req, res) => {
    // Get basic statistics
    db.get("SELECT COUNT(*) as count FROM attendees", (err, total) => {
        if (err) {
            console.error('Error getting total attendees:', err);
            return res.redirect('/organizer/dashboard');
        }

        // Get feedback statistics
        db.all(`
            SELECT COUNT(*) as feedback_count, 
                   AVG(rating) as average_rating,
                   rating,
                   COUNT(*) as count
            FROM feedback
            GROUP BY rating
            ORDER BY rating DESC
        `, (err, feedbackStats) => {
            if (err) {
                console.error('Error getting feedback statistics:', err);
                return res.redirect('/organizer/dashboard');
            }

            // Calculate rating distribution percentages
            const totalFeedbacks = feedbackStats.reduce((sum, stat) => sum + stat.count, 0);
            const ratingDistribution = {};
            feedbackStats.forEach(stat => {
                ratingDistribution[stat.rating] = ((stat.count / totalFeedbacks) * 100).toFixed(1);
            });

            // Get recent feedbacks
            db.all(`
                SELECT f.*, a.name as attendee_name 
                FROM feedback f
                JOIN attendees a ON f.attendee_id = a.id
                ORDER BY f.timestamp DESC
                LIMIT 5
            `, (err, recentFeedbacks) => {
                if (err) {
                    console.error('Error getting recent feedbacks:', err);
                    return res.redirect('/organizer/dashboard');
                }

                // Get other statistics
                db.get("SELECT COUNT(*) as count FROM attendees WHERE registered = 1", (err, registered) => {
                    if (err) {
                        console.error('Database error in organizer dashboard:', err);
                        req.session.flash = { type: 'error', message: 'An error occurred while loading the dashboard.' };
                        return res.redirect('/organizer_login');
                    }

                    db.get("SELECT COUNT(*) as count FROM attendees WHERE lunch_received = 1", (err, lunches) => {
                        if (err) {
                            console.error('Error getting lunch count:', err);
                            return res.redirect('/organizer/dashboard');
                        }

                        db.get("SELECT COUNT(*) as count FROM attendees WHERE swags_received = 1", (err, swags) => {
                            if (err) {
                                console.error('Error getting swags count:', err);
                                return res.redirect('/organizer/dashboard');
                            }

                            // Get all attendees
                            db.all("SELECT * FROM attendees", (err, attendees) => {
                                if (err) {
                                    console.error('Error getting attendees:', err);
                                    return res.redirect('/organizer/dashboard');
                                }

                                res.render('organizer_dashboard', {
                                    messages: getFlashMessages(req),
                                    total_attendees: total.count,
                                    total_registered: registered.count,
                                    total_lunches: lunches.count,
                                    total_swags: swags.count,
                                    feedback_count: totalFeedbacks,
                                    average_rating: feedbackStats[0]?.average_rating || 0,
                                    rating_distribution: ratingDistribution,
                                    feedbacks: recentFeedbacks,
                                    attendees: attendees
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/organizer/add_attendee', loginRequired('organizer'), (req, res) => {
    res.render('add_attendee', { messages: getFlashMessages(req), nfcEnabled });
});

app.post('/organizer/add_attendee', loginRequired('organizer'), async (req, res) => {
    const { name, email, phone, role } = req.body;
    const userId = uuidv4();
    let username = email.split('@')[0];
    const password = 'attendee123';
    const attendeeId = await generateAttendeeId(name);
    const nftTokenId = generateNFTToken(attendeeId);
    const userRole = role.toLowerCase() === 'organizer' ? 'organizer' : 'attendee';

    try {
        let suffix = 1;
        let uniqueUsername = username;
        while (true) {
            const existingUser = await new Promise((resolve, reject) => {
                db.get("SELECT username FROM users WHERE username = ?", [uniqueUsername], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });
            if (!existingUser) break;
            uniqueUsername = `${username}_${suffix}`;
            suffix++;
        }

        const qrPath = await generateQR(attendeeId);
        await new Promise((resolve, reject) => {
            db.run("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)", [userId, uniqueUsername, password, userRole], (err) => {
                if (err) {
                    console.error('Error adding user:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO attendees (id, user_id, name, email, phone, role, qr_code, nft_token_id, registered, lunch_received, swags_received) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`, [attendeeId, userId, name, email, phone, role, qrPath, nftTokenId], (err) => {
                if (err) {
                    console.error('Error adding attendee:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        const emailSent = await sendEmail(email, uniqueUsername, password);
        if (emailSent) {
            req.session.flash = { type: 'success', message: `Attendee added! Username: ${uniqueUsername}, Password: ${password}. Credentials sent to ${email}.` };
        } else {
            req.session.flash = { type: 'warning', message: `Attendee added! Username: ${uniqueUsername}, Password: ${password}. Failed to send email to ${email}. Check server logs.` };
        }
        res.redirect('/organizer/dashboard');
    } catch (err) {
        req.session.flash = { type: 'error', message: 'Error adding attendee.' };
        res.redirect('/organizer/add_attendee');
    }
});

app.get('/organizer/upload_csv', loginRequired('organizer'), (req, res) => {
    res.render('upload_csv', { messages: getFlashMessages(req), nfcEnabled });
});

app.post('/organizer/upload_csv', loginRequired('organizer'), upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        req.session.flash = { type: 'error', message: 'No file uploaded.' };
        return res.redirect('/organizer/upload_csv');
    }

    const results = [];
    let failedEmails = 0;

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                for (const row of results) {
                    const { Name: name, Email: email, Phone: phone, Role: role } = row;
                    if (!name || !email || !phone || !role) {
                        req.session.flash = { type: 'error', message: 'CSV file must contain Name, Email, Phone, and Role columns.' };
                        fs.unlinkSync(req.file.path);
                        return res.redirect('/organizer/upload_csv');
                    }

                    const userId = uuidv4();
                    let username = email.split('@')[0];
                    const password = 'attendee123';
                    const attendeeId = await generateAttendeeId(name);
                    const nftTokenId = generateNFTToken(attendeeId);
                    const userRole = role.toLowerCase() === 'organizer' ? 'organizer' : 'attendee';

                    let suffix = 1;
                    let uniqueUsername = username;
                    while (true) {
                        const existingUser = await new Promise((resolve, reject) => {
                            db.get("SELECT username FROM users WHERE username = ?", [uniqueUsername], (err, row) => {
                                if (err) reject(err);
                                resolve(row);
                            });
                        });
                        if (!existingUser) break;
                        uniqueUsername = `${username}_${suffix}`;
                        suffix++;
                    }

                    const qrPath = await generateQR(attendeeId);
                    await new Promise((resolve, reject) => {
                        db.run("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)", [userId, uniqueUsername, password, userRole], (err) => {
                            if (err) {
                                console.error('Error adding user from CSV:', err);
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    });
                    await new Promise((resolve, reject) => {
                        db.run(`INSERT INTO attendees (id, user_id, name, email, phone, role, qr_code, nft_token_id, registered, lunch_received, swags_received) 
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`, [attendeeId, userId, name, email, phone, role, qrPath, nftTokenId], (err) => {
                            if (err) {
                                console.error('Error adding attendee from CSV:', err);
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    });

                    const emailSent = await sendEmail(email, uniqueUsername, password);
                    if (!emailSent) {
                        failedEmails++;
                        console.log(`Warning: Failed to send email to ${email}`);
                    }
                }
                req.session.flash = { type: 'success', message: `Successfully registered ${results.length} attendees! Default password: attendee123. Emails failed for ${failedEmails} attendees.` };
            } catch (err) {
                req.session.flash = { type: 'error', message: `Error processing CSV file: ${err.message}` };
            } finally {
                fs.unlinkSync(req.file.path);
            }
            res.redirect('/organizer/dashboard');
        })
        .on('error', (err) => {
            console.error('CSV parsing error:', err);
            req.session.flash = { type: 'error', message: 'Error parsing CSV file.' };
            fs.unlinkSync(req.file.path);
            res.redirect('/organizer/upload_csv');
        });
});

app.get('/organizer/checkin', loginRequired('organizer'), (req, res) => {
    res.render('checkin', { messages: getFlashMessages(req), attendee: null, nfcEnabled });
});

app.post('/organizer/checkin', loginRequired('organizer'), (req, res) => {
    const { attendee_id } = req.body;
    db.get("SELECT * FROM attendees WHERE id = ?", [attendee_id], (err, attendee) => {
        if (err) {
            console.error('Database error during check-in:', err);
            req.session.flash = { type: 'error', message: 'An error occurred while checking in.' };
            return res.redirect('/organizer/checkin');
        }
        if (!attendee) {
            req.session.flash = { type: 'error', message: 'Attendee not found.' };
            return res.redirect('/organizer/checkin');
        }
        if (attendee.registered) {
            req.session.flash = { type: 'error', message: 'Attendee already checked in.' };
            return res.render('checkin', { messages: getFlashMessages(req), attendee, nfcEnabled });
        }
        db.run("UPDATE attendees SET registered = 1 WHERE id = ?", [attendee_id], (err) => {
            if (err) {
                console.error('Database error during check-in update:', err);
                req.session.flash = { type: 'error', message: 'An error occurred while updating check-in status.' };
                return res.redirect('/organizer/checkin');
            }
            req.session.flash = { type: 'success', message: `Attendee ${attendee.name} checked in successfully!` };
            res.redirect('/organizer/checkin');
        });
    });
});

app.get('/organizer/lunch', loginRequired('organizer'), (req, res) => {
    res.render('lunch', { messages: getFlashMessages(req), attendee: null, nfcEnabled });
});

app.post('/organizer/lunch', loginRequired('organizer'), (req, res) => {
    if (!nfcEnabled) {
        req.session.flash = { type: 'error', message: 'NFC is disabled. Please enable NFC to register lunch.' };
        return res.redirect('/organizer/lunch');
    }

    const { attendee_id } = req.body;
    db.get("SELECT * FROM attendees WHERE id = ?", [attendee_id], (err, attendee) => {
        if (err) {
            console.error('Database error during lunch registration:', err);
            req.session.flash = { type: 'error', message: 'An error occurred while registering lunch.' };
            return res.redirect('/organizer/lunch');
        }
        if (!attendee) {
            req.session.flash = { type: 'error', message: 'Attendee not found.' };
            return res.redirect('/organizer/lunch');
        }
        if (attendee.lunch_received) {
            req.session.flash = { type: 'error', message: 'Lunch already received by this person.' };
            return res.render('lunch', { messages: getFlashMessages(req), attendee, nfcEnabled });
        }
        db.run("UPDATE attendees SET lunch_received = 1 WHERE id = ?", [attendee_id], (err) => {
            if (err) {
                console.error('Database error during lunch update:', err);
                req.session.flash = { type: 'error', message: 'An error occurred while updating lunch status.' };
                return res.redirect('/organizer/lunch');
            }
            req.session.flash = { type: 'success', message: `Lunch received by ${attendee.name} (${attendee.role})!` };
            res.redirect('/organizer/lunch');
        });
    });
});

app.get('/organizer/swags', loginRequired('organizer'), (req, res) => {
    res.render('swags', { messages: getFlashMessages(req), attendee: null, nfcEnabled });
});

app.post('/organizer/swags', loginRequired('organizer'), (req, res) => {
    if (!nfcEnabled) {
        req.session.flash = { type: 'error', message: 'NFC is disabled. Please enable NFC to register swags.' };
        return res.redirect('/organizer/swags');
    }

    const { attendee_id } = req.body;
    db.get("SELECT * FROM attendees WHERE id = ?", [attendee_id], (err, attendee) => {
        if (err) {
            console.error('Database error during swags registration:', err);
            req.session.flash = { type: 'error', message: 'An error occurred while registering swags.' };
            return res.redirect('/organizer/swags');
        }
        if (!attendee) {
            req.session.flash = { type: 'error', message: 'Attendee not found.' };
            return res.redirect('/organizer/swags');
        }
        if (attendee.swags_received) {
            req.session.flash = { type: 'error', message: 'Swags already received by this person.' };
            return res.render('swags', { messages: getFlashMessages(req), attendee, nfcEnabled });
        }
        db.run("UPDATE attendees SET swags_received = 1 WHERE id = ?", [attendee_id], (err) => {
            if (err) {
                console.error('Database error during swags update:', err);
                req.session.flash = { type: 'error', message: 'An error occurred while updating swags status.' };
                return res.redirect('/organizer/swags');
            }
            req.session.flash = { type: 'success', message: `Swags received by ${attendee.name} (${attendee.role})!` };
            res.redirect('/organizer/swags');
        });
    });
});

app.post('/organizer/toggle_nfc', loginRequired('organizer'), (req, res) => {
    nfcEnabled = !nfcEnabled;
    req.session.flash = { type: 'success', message: `NFC is now ${nfcEnabled ? 'enabled' : 'disabled'}.` };
    res.redirect(req.get('referer') || '/organizer/dashboard');
});

app.get('/attendee/events', loginRequired('attendee'), (req, res) => {
    db.get("SELECT registered, lunch_received, swags_received FROM attendees WHERE user_id = ?", [req.session.userId], (err, attendee) => {
        if (err) {
            console.error('Database error in events page:', err);
            req.session.flash = { type: 'error', message: 'An error occurred while loading your events.' };
            return res.redirect('/attendee_login');
        }
        if (!attendee) {
            req.session.flash = { type: 'error', message: 'Attendee not found.' };
            return res.redirect('/attendee_login');
        }
        db.get("SELECT * FROM events WHERE id = 'event1'", (err, event) => {
            if (err) {
                console.error('Database error fetching event:', err);
                req.session.flash = { type: 'error', message: 'An error occurred while loading event details.' };
                return res.redirect('/attendee_login');
            }
            db.all("SELECT * FROM sessions WHERE event_id = 'event1'", (err, sessions) => {
                if (err) {
                    console.error('Database error fetching sessions:', err);
                    req.session.flash = { type: 'error', message: 'An error occurred while loading session schedule.' };
                    return res.redirect('/attendee_login');
                }
                res.render('attendee_events', {
                    messages: getFlashMessages(req),
                    checkedIn: attendee.registered,
                    lunchReceived: attendee.lunch_received,
                    swagsReceived: attendee.swags_received,
                    event,
                    sessions
                });
            });
        });
    });
});

app.get('/attendee/qr_code', loginRequired('attendee'), (req, res) => {
    db.get("SELECT id, qr_code, nft_token_id FROM attendees WHERE user_id = ?", [req.session.userId], (err, attendee) => {
        if (err) {
            console.error('Database error in QR code page:', err);
            req.session.flash = { type: 'error', message: 'An error occurred while loading your QR code.' };
            return res.redirect('/attendee/events');
        }
        if (!attendee) {
            req.session.flash = { type: 'error', message: 'Attendee not found.' };
            return res.redirect('/attendee/events');
        }
        res.render('qr_code', {
            messages: getFlashMessages(req),
            qr_code_path: attendee.qr_code,
            attendee_id: attendee.id,
            nft_token_id: attendee.nft_token_id
        });
    });
});

app.post('/attendee/submit_feedback', loginRequired('attendee'), (req, res) => {
    const { rating, comments } = req.body;
    const userId = req.session.userId;
    
    // First get the attendee ID from the user ID
    db.get("SELECT id FROM attendees WHERE user_id = ?", [userId], (err, attendee) => {
        if (err) {
            console.error('Error getting attendee:', err);
            req.session.flash = { type: 'error', message: 'An error occurred while submitting feedback.' };
            return res.redirect('/attendee/events');
        }

        if (!attendee) {
            req.session.flash = { type: 'error', message: 'Attendee not found.' };
            return res.redirect('/attendee/events');
        }

        // Get the current event ID
        db.get("SELECT id FROM events LIMIT 1", (err, event) => {
            if (err) {
                console.error('Error getting event:', err);
                req.session.flash = { type: 'error', message: 'An error occurred while submitting feedback.' };
                return res.redirect('/attendee/events');
            }

            // Insert feedback
            const feedbackId = uuidv4();
            db.run(`INSERT INTO feedback (id, attendee_id, event_id, rating, comments) VALUES (?, ?, ?, ?, ?)`,
                [feedbackId, attendee.id, event.id, rating, comments],
                (err) => {
                    if (err) {
                        console.error('Error submitting feedback:', err);
                        req.session.flash = { type: 'error', message: 'An error occurred while submitting feedback.' };
                        return res.redirect('/attendee/events');
                    }
                    req.session.flash = { type: 'success', message: 'Thank you for your feedback!' };
                    res.redirect('/attendee/events');
                }
            );
        });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    fs.mkdirSync(path.join(__dirname, 'public', 'qr_codes'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
});