# Credentials Folder

## The purpose of this folder is to store all credentials needed to log into your server and databases. This is important for many reasons. But the two most important reasons is
    1. Grading , servers and databases will be logged into to check code and functionality of application. Not changes will be unless directed and coordinated with the team.
    2. Help. If a class TA or class CTO needs to help a team with an issue, this folder will help facilitate this giving the TA or CTO all needed info AND instructions for logging into your team's server. 


# Below is a list of items required. Missing items will causes points to be deducted from multiple milestone submissions.

1. Server URL or IP <br>```18.217.207.30```
2. SSH username <br>
       ```professor```
4. SSH password or key. <br>
       ```Popeyes_123```
    <br> If a ssh key is used please upload the key to the credentials folder.
6. Database URL or IP and port used.
    <br><strong> NOTE THIS DOES NOT MEAN YOUR DATABASE NEEDS A PUBLIC FACING PORT.</strong> But knowing the IP and port number will help with SSH tunneling into the database. The default port is more than sufficient for this class. <br>
       ```18.217.207.30:3306```
7. Database username  <br>
       ```edugator_user```
8. Database password  <br>
       ```edugator_01```
10. Database name (basically the name that contains all your tables) <br> 
        ```edugator_db```
12. Instructions on how to use the above information.<br><br>
    **SSH Access to Server:**  
    1. Use an SSH client (Terminal on Mac/Linux/PuTTY on Windows)<br>
    2. Type ```ssh professor@18.217.207.30```   
    3. When prompted, enter the password: ```Popeyes_123```
    4. To access the repository, you'll need to move up one directory, then move into the team5 directory: <br>
       ```cd ../team5```
       
    

    **Database Access (from the server):**   
    1. First SSH into the server.
    2. Then connect to MySQL: ```mysql -u edugator_user -p edugator_db```   
    3. When prompted, enter the password: ```edugator_01```

# Most important things to Remember
## These values need to kept update to date throughout the semester. <br>
## <strong>Failure to do so will result it points be deducted from milestone submissions.</strong><br>
## You may store the most of the above in this README.md file. DO NOT Store the SSH key or any keys in this README.md file.










