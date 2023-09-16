# Todoist-GCal
```
Functionality:

GCal = Google Calendar
GTasks = Google Tasks

When a Todoist task is created: 
-Todoist <priority> will determine the <colour> of the GCal event.
-Todoist <section> will determine the GCal calendar.
-Todoist <description> will be the GCal description
*When the Todoist task is marked as <completed>, it should delete the GCal event and replace it with a <completed> GTasks task. If the GCal event has a <time range>, the GTasks task should only use the <start time> since there is no <end time> for GTasks tasks. The <description> will be the same as the GCal description
*When a Todoist task is marked as uncompleted, the GTasks task must delete itself and a GCal event with the original values for <priority>, <section>, etc is created

Ideally, since each Todoist task has its own unique identifier, each Todoist action on a Todoist task should perform a check to see if that GCal event/GTasks task exists and/or if the fields match the existing one. If it doesn't, it should ensure the GCal event/GTasks task exists and matches.
```
