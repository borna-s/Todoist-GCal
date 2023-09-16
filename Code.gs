var TODOIST_API = "https://api.todoist.com/rest/v2/tasks";
var scriptProperties = PropertiesService.getScriptProperties();
var API_KEY = scriptProperties.getProperty('TODOIST_API_KEY');
var VERIFICATION_TOKEN = scriptProperties.getProperty('VERIFICATION_TOKEN');
var GOOGLE_TASKS_LIST = getListIdByName("2023-2024");


function doGet() {
    var textOutput = ContentService.createTextOutput("Method Not Allowed");
    textOutput.setMimeType(ContentService.MimeType.TEXT);
    return textOutput.setResponseCode(405);
}



function doPost(e) {
    if (!e || !e.postData) {
        return respond("No postData received");
    }
    
    var eventData;
    try {
        eventData = JSON.parse(e.postData.contents);
    } catch(err) {
        return respond("Invalid JSON data");
    }

    if (!isValidEvent(eventData)) {
        return respond("Invalid event data structure");
    }

    eventData = sanitizeEvent(eventData);

    switch(eventData.event_name) {
        case "sync:verify":
            return respond("Ok");
        case "item:added":
            handleItemAdded(eventData);
            break;
        case "item:updated":
            handleItemUpdated(eventData);
            break;
        case "item:deleted":
            handleItemDeleted(eventData);
            break;
        case "item:completed":
            handleItemCompleted(eventData);
            break;
        case "item:uncompleted":
            handleItemUncompleted(eventData);
            break;
    }
    
    return respond("Received");
}

// Utility functions
function respond(message) {
    Logger.log(message);
    return ContentService.createTextOutput(message);
}

function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^\w\s]/gi, '');
}

function formatDateForTodoist(date) {
    return Utilities.formatDate(date, "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

// Validation and sanitation functions
function isValidEvent(eventData) {
    return eventData 
        && typeof eventData === 'object'
        && typeof eventData.event_name === 'string' 
        && typeof eventData.event_data === 'object';
}

function sanitizeEvent(eventData) {
    eventData.event_name = sanitizeString(eventData.event_name);
    return eventData;
}

// Event Handlers
function handleItemAdded(eventData) {
    var taskContent = eventData.event_data.content;
    var todoistId = eventData.event_data.id;
    var dueDate = eventData.event_data.due ? eventData.event_data.due.date : undefined;
    var priority = eventData.event_data.priority;
    var labels = eventData.event_data.labels;
    var section = eventData.event_data.section_name;

    addEventToGoogleCalendar(taskContent, todoistId, dueDate, priority, labels, section);
}

function handleItemUpdated(eventData) {
    var updatedContent = eventData.event_data.content;
    var todoistId = eventData.event_data.id;
    var calendarEventId = findGoogleEventIdByTodoistId(todoistId);
    if (calendarEventId) {
        var calendarEvent = getGoogleCalendarEventById(calendarEventId);
        if (calendarEvent) {
            calendarEvent.setTitle(updatedContent + getEmojiBySection(eventData.event_data.section_name));
            calendarEvent.setDescription(eventData.event_data.labels.join(", "));
        }
    }
}

function handleItemDeleted(eventData) {
    var todoistId = eventData.event_data.id;
    deleteGoogleTask(todoistId);
}

function handleItemCompleted(eventData) {
    var todoistId = eventData.event_data.id;

    var calendarEventId = findGoogleEventIdByTodoistId(todoistId);
    if (calendarEventId) {
        var event = getGoogleCalendarEventById(calendarEventId);
        var startTime = event.getStartTime();
        var description = event.getDescription();

        deleteGoogleCalendarEvent(calendarEventId);
        addGoogleTaskFromEvent(eventData.event_data, startTime, description); // Add the completed task to Google Tasks.
    }
}

function handleItemUncompleted(eventData) {
    var gTaskId = findGoogleTaskIdByTodoistId(eventData.event_data.id);
    if (gTaskId) {
        var taskDetails = getGoogleTaskDetails(gTaskId);
        deleteGoogleTask(gTaskId);
        addEventToGoogleCalendar(
            taskDetails.title, 
            eventData.event_data.id, 
            taskDetails.due, 
            eventData.event_data.priority,
            eventData.event_data.labels, 
            eventData.event_data.section
        );
    }
}

function uncompleteGoogleTask(todoistId) {
    deleteGoogleTask(todoistId);  // Directly delete the task from Google Tasks.
}

function handleGoogleCalendarEventCompletion(calendarEventId, eventData) {
    var event = getGoogleCalendarEventById(calendarEventId);
    if (!event) return;

    var startTime = event.getStartTime();
    deleteGoogleCalendarEvent(calendarEventId);
    
    var taskDetails = extractTaskDetails(eventData);
    addAndCompleteGoogleTask(taskDetails, startTime);
}

// ... (Your previous code)

// Handle Todoist to Google Calendar and Google Tasks sync
function handleTodoistTaskCompletion(todoistTask) {
    let mappedDetails = mapTodoistToGoogle(todoistTask);
    let calendar = CalendarApp.getCalendarsByName(mappedDetails.calendar)[0];
    
    // Find the event using title and description (ensure this is unique enough)
    let events = calendar.getEvents(mappedDetails.startTime, new Date(), {
        search: todoistTask.content
    });
    
    for (let event of events) {
        if (event.getDescription() === mappedDetails.description) {
            event.deleteEvent();
            createCompletedGoogleTask(todoistTask);
            break;
        }
    }
}

function handleTodoistTaskUncompletion(todoistTask) {
    let taskId = findGoogleTaskIdByTodoistId(todoistTask.id);
    
    if (taskId) {
        Tasks.Tasks.delete('YOUR_TASKLIST_ID', taskId);
        createGoogleCalendarEventFromTodoistTask(todoistTask);
    }
}

function createCompletedGoogleTask(todoistTask) {
    let mappedDetails = mapTodoistToGoogle(todoistTask);
    
    let task = {
        title: todoistTask.content,
        notes: mappedDetails.description,
        due: mappedDetails.startTime
    };
    
    // Using Google Tasks API to insert the task and immediately mark it as complete
    let insertedTask = Tasks.Tasks.insert(task, 'YOUR_TASKLIST_ID');
    insertedTask.setStatus('completed');
    Tasks.Tasks.update(insertedTask, 'YOUR_TASKLIST_ID', insertedTask.id);
}

function createGoogleCalendarEventFromTodoistTask(todoistTask) {
    let mappedDetails = mapTodoistToGoogle(todoistTask);
    let calendar = CalendarApp.getCalendarsByName(mappedDetails.calendar)[0];
    
    let event = calendar.createAllDayEvent(todoistTask.content, mappedDetails.startTime, {
        description: mappedDetails.description,
        color: mappedDetails.color
    });
    
    return event;
}

function regenerateGoogleCalendarEventFromTask(eventData) {
    var taskContent = eventData.event_data.content;
    var dueDate = eventData.event_data.due ? eventData.event_data.due.date : undefined;
    var priority = eventData.event_data.priority;
    var labels = eventData.event_data.labels;
    var section = eventData.event_data.section_name;   
    addEventToGoogleCalendar(taskContent, eventData.event_data.id, dueDate, priority, labels, section);
}

// ... (Rest of your code)



function createCompletedGoogleTask(todoistTask) {
    let mappedDetails = mapTodoistToGoogle(todoistTask);
    
    let task = {
        title: todoistTask.content,
        notes: mappedDetails.description,
        due: mappedDetails.startTime
    };
    
    // Using Google Tasks API to insert the task and immediately mark it as complete
    let insertedTask = Tasks.Tasks.insert(task, 'YOUR_TASKLIST_ID');
    insertedTask.setStatus('completed');
    Tasks.Tasks.update(insertedTask, 'YOUR_TASKLIST_ID', insertedTask.id);
}

function getGoogleTaskDetails(gTaskId) {
    // Make an API call to Google Tasks to retrieve details of a specific task.
    // For simplicity, I'm pseudo-coding this. Replace with actual Google Task API call.
    
    return {
        title: "Sample Task Title",  // Replace with the actual title from the API response.
        due: new Date(),             // Replace with the actual due date from the API response.
        // ... any other needed properties
    };
}

function extractTaskDetails(eventData) {
    return {
        content: eventData.event_data.content,
        parentId: eventData.event_data.parent_id,
        priority: eventData.event_data.priority,
        labels: eventData.event_data.labels
    };
}

function addEventToGoogleCalendar(taskContent, todoistId, dueDate, priority, labels, section) {
    var calendar = CalendarApp.getDefaultCalendar();
    
    var eventOptions = {
        description: labels.join(", "), 
        color: getCalendarColorByPriority(priority)
    };
    
    taskContent = `${getEmojiBySection(section)} ${taskContent}`;  
    if (dueDate) {
        calendar.createAllDayEvent(taskContent, new Date(dueDate), eventOptions);
    } else {
        calendar.createEvent(taskContent, new Date(), new Date(), eventOptions);
    }
}

function getEmojiBySection(section) {
    const sectionEmojiMap = {
        "Work": "💼",
        "Personal": "🏠",
        "Fitness": "🏋️",
        //... Add other sections and their corresponding emojis
    };

    return sectionEmojiMap[section] || '';  // Return an empty string if the section is not recognized.
}

function getCalendarColorByPriority(priority) {
    // A sample mapping for Todoist priorities to Google Calendar event colors.
    const colorMap = {
        1: 'Tomato',   // High priority
        2: 'Orange',
        3: 'Yellow',
        4: 'Green'     // Low priority
    };

    return colorMap[priority] || 'Default';  // Default color if priority is not recognized.
}

function mapTodoistToGoogle(todoistTask) {
    let calendarMapping = {
        'Work': 'WorkCalendarName',
        'Personal': 'PersonalCalendarName',
        //... add other mappings
    };
    
    let colorMapping = {
        1: CalendarApp.EventColor.RED,
        2: CalendarApp.EventColor.ORANGE,
        3: CalendarApp.EventColor.YELLOW,
        4: CalendarApp.EventColor.GREEN,
    };
    
    return {
        calendar: calendarMapping[todoistTask.section],
        color: colorMapping[todoistTask.priority],
        description: todoistTask.description,
        startTime: new Date(todoistTask.due.date),
        endTime: null  // This will be changed if necessary
    };
}

function createGoogleCalendarEventFromTodoistTask(todoistTask) {
    let mappedDetails = mapTodoistToGoogle(todoistTask);
    let calendar = CalendarApp.getCalendarsByName(mappedDetails.calendar)[0];
    
    let event = calendar.createAllDayEvent(todoistTask.content, mappedDetails.startTime, {
        description: mappedDetails.description,
        color: mappedDetails.color
    });
    
    return event;
}

function regenerateGoogleCalendarEventFromTask(eventData) {
    var taskContent = eventData.event_data.content;
    var dueDate = eventData.event_data.due ? eventData.event_data.due.date : undefined;
    var priority = eventData.event_data.priority;
    var labels = eventData.event_data.labels;
    var section = eventData.event_data.section_name;   
    addEventToGoogleCalendar(taskContent, eventData.event_data.id, dueDate, priority, labels, section);
}

function addAndCompleteGoogleTask(taskDetails, startTime) {
    addTaskToGoogleTasks(taskDetails.content, taskDetails.parentId, startTime, taskDetails.priority, taskDetails.labels);
    var gTaskId = findGoogleTaskIdByTodoistId(taskDetails.todoistId);
    if (gTaskId) {
        completeGoogleTask(gTaskId);
    }
}

function addGoogleTaskFromEvent(eventData, startTime, description) {
    var taskTitle = eventData.content;
    var taskNotes = description + "\nTodoistID:" + eventData.id;  // Using the Google Calendar event's description and TodoistID as notes for Google Task.
    
    // Create a Google Task with the above details.
    var newTask = {
        title: taskTitle,
        notes: taskNotes,
        due: startTime
    };
    insertTaskToGoogleTasks(newTask);
}

// Handle Google Calendar to Todoist sync
function createTodoistTaskFromEvent(event) {
    var eventData = {
        content: event.getTitle(),
        due: {
            date: formatDateForTodoist(event.getStartTime())
        },
        labels: event.getDescription().split(", "),
        priority: getPriorityByCalendarColor(event.getColor())
    };
    
    createTaskInTodoist(eventData);
}

function getPriorityByCalendarColor(color) {
    switch(color) {
        case CalendarApp.EventColor.RED: return 1;
        case CalendarApp.EventColor.ORANGE: return 2;
        case CalendarApp.EventColor.YELLOW: return 3;
        case CalendarApp.EventColor.GREEN: return 4;
        default: return 4;
    }
}

function createTaskInTodoist(taskData) {
    var options = {
        'method': 'post',
        'headers': {
            'Authorization': 'Bearer ' + API_KEY
        },
        'contentType': 'application/json',
        'payload': JSON.stringify(taskData)
    };
  
    UrlFetchApp.fetch(TODOIST_API, options);
}

function isEventSyncedWithTodoist(event) {
    return event.getDescription().includes("TodoistID:");
}

function extractTaskDetails(eventData) {
    var labels = (eventData.event_data.labels && eventData.event_data.labels.length > 0) ? "Labels: " + eventData.event_data.labels.join(", ") + "\n" : "";
    var priority = eventData.event_data.priority ? "Priority: " + eventData.event_data.priority + "\n" : "";

    return {
        content: eventData.event_data.content,
        notes: labels + priority + "TodoistID:" + eventData.event_data.id
    };
}

function addAndCompleteGoogleTask(taskDetails, startTime) {
    var task = formatNewTask(taskDetails.content, taskDetails.notes);
    var insertedTask = insertTaskToGoogleTasks(task);
    if (insertedTask) {
        completeGoogleTask(insertedTask.id);
    }
}

// Google Tasks Operations
function ensureGoogleTasksList() {
    if (!GOOGLE_TASKS_LIST) {
        GOOGLE_TASKS_LIST = getListIdByName("2023-2024");
    }
}

function handleCalendarEvents() {
    var calendar = getCalendarByName("2023-2024");
    if (!calendar) {
        Logger.log("Calendar not found");
        return;
    }
    var todayEvents = getEventsForToday(calendar);
    todayEvents.forEach(event => {
        processCalendarEvent(event);
    });
}

function getCalendarByName(name) {
    var calendars = CalendarApp.getCalendarsByName(name);
    return calendars.length ? calendars[0] : null;
}

function getEventsForToday(calendar) {
    var now = new Date();
    return calendar.getEventsForDay(now);
}

function processCalendarEvent(event) {
    if (!isEventSyncedWithTodoist(event)) {
        createTodoistTaskFromEvent(event);
    }
}

function findGoogleEventIdByTodoistId(todoistId) {
    var calendar = CalendarApp.getDefaultCalendar();
    var events = calendar.getEvents(new Date(0), new Date());
    for(var i = 0; i < events.length; i++) {
        if(events[i].getDescription().includes("TodoistID:" + todoistId)) {
            return events[i].getId();
        }
    }
    return null;
}

function getGoogleCalendarEventById(eventId) {
    return CalendarApp.getDefaultCalendar().getEventById(eventId);
}

function deleteGoogleCalendarEvent(eventId) {
    var event = getGoogleCalendarEventById(eventId);
    if (event) {
        event.deleteEvent();
    }
}

function findGoogleTaskIdByTodoistId(todoistId) {
    ensureGoogleTasksList();
    var tasks = Tasks.Tasks.list(GOOGLE_TASKS_LIST).getItems() || [];
    for(var task of tasks) {
        if(task.getNotes().includes("TodoistID:" + todoistId)) {
            return task.getId();
        }
    }
    return null;
}

function operateOnGoogleTask(todoistId, action, options) {
    var taskId = findGoogleTaskIdByTodoistId(todoistId);
    if(!taskId) return;

    switch(action) {
        case 'update':
            var updatedTask = Tasks.Tasks.get(GOOGLE_TASKS_LIST, taskId);
            updatedTask.setTitle(options.content);
            Tasks.Tasks.update(updatedTask, GOOGLE_TASKS_LIST, taskId);
            break;
        case 'delete':
            Tasks.Tasks.delete(GOOGLE_TASKS_LIST, taskId);
            break;
        case 'toggleCompletion':
            var taskToToggle = Tasks.Tasks.get(GOOGLE_TASKS_LIST, taskId);
            taskToToggle.setStatus(options.completeStatus ? "completed" : "needsAction");
            Tasks.Tasks.update(taskToToggle, GOOGLE_TASKS_LIST, taskId);
            break;
    }
}

function updateGoogleTask(content, todoistId) {
    operateOnGoogleTask(todoistId, 'update', { content: content });
}

function deleteGoogleTask(todoistId) {
    operateOnGoogleTask(todoistId, 'delete', {});
}

function completeGoogleTask(todoistId) {
    operateOnGoogleTask(todoistId, 'toggleCompletion', { completeStatus: true });
}

function uncompleteGoogleTask(todoistId) {
    operateOnGoogleTask(todoistId, 'toggleCompletion', { completeStatus: false });
}

function addTaskToGoogleTasks(taskContent, todoistId, parentId, dueDate, priority, labels) {
    ensureGoogleTasksList();
    if (isTaskAlreadyInGoogleTasks(todoistId)) {
        return;
    }
    var newTask = formatNewTask(taskContent, todoistId, parentId, dueDate, priority, labels);
    insertTaskToGoogleTasks(newTask);
}

function isTaskAlreadyInGoogleTasks(todoistId) {
    return findGoogleTaskIdByTodoistId(todoistId);
}

function formatNewTask(taskContent, todoistId, parentId, dueDate, priority, labels) {
    var formattedLabels = labels ? "Labels:" + labels.join(", ") + "\n" : "";
    var formattedPriority = priority ? "Priority:" + priority + "\n" : "";
    var googleParentId = parentId ? findGoogleTaskIdByTodoistId(parentId) : undefined;

    return {
        title: taskContent,
        notes: formattedPriority + formattedLabels + "TodoistID:" + todoistId,
        due: dueDate ? new Date(dueDate) : undefined,
        parent: googleParentId
    };
}

function insertTaskToGoogleTasks(task) {
    ensureGoogleTasksList();
    return Tasks.Tasks.insert(task, GOOGLE_TASKS_LIST);
}

function getListIdByName(name) {
    var taskLists = Tasks.Tasklists.list().getItems();
    for (var i = 0; i < taskLists.length; i++) {
        if (taskLists[i].getTitle() === name) {
            return taskLists[i].getId();
        }
    }
    // If no list with the given name is found, create one
    var newList = Tasks.Tasklists.insert({ title: name });
    return newList.getId();
}

function getTodoistTaskDetailsFromEvent(event) {
    var description = event.getDescription();
    var priority = getPriorityByCalendarColor(event.getColor());
    var section = event.getCalendar().getName();  // assuming the calendar name maps to Todoist section
    
    return {
        content: event.getTitle(),
        due: { date: formatDateForTodoist(event.getStartTime()) },
        priority: priority,
        description: description,
        section: section
    };
}

function syncCompletedTodoistTaskToGoogle(todoistTaskId) {
    var eventId = findGoogleEventIdByTodoistId(todoistTaskId);
    if (eventId) {
        var event = getGoogleCalendarEventById(eventId);
        var taskDetails = {
            content: event.getTitle(),
            notes: event.getDescription(),
            due: event.getStartTime()
        };
        
        addAndCompleteGoogleTask(taskDetails);
        deleteGoogleCalendarEvent(eventId);
    }
}

function syncUncompletedTodoistTaskToGoogle(todoistTaskId) {
    var taskId = findGoogleTaskIdByTodoistId(todoistTaskId);
    if (taskId) {
        var task = Tasks.Tasks.get(GOOGLE_TASKS_LIST, taskId);
        var eventData = {
            content: task.title,
            description: task.notes,  // Assuming you've stored the original Todoist task's description here
            startTime: task.due, // or any date-time manipulation if needed
            endTime: task.due, // or adjust as needed
            color: getCalendarColorByPriority(task.priority)
        };
        
        createGoogleEventFromTaskDetails(eventData);
        deleteGoogleTask(todoistTaskId);
    }
}

function createGoogleEventFromTaskDetails(data) {
    var calendar = getCalendarByName(data.section);  // or however you map Todoist sections to calendar names
    calendar.createEvent(data.content, data.startTime, data.endTime, { description: data.description, color: data.color });
}

