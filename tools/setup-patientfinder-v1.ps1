<#
PatientFinder Lite - Version 1 SharePoint Setup Script
Creates empty SharePoint lists/library and schema for Microsoft 365-only PatientFinder shell.

SAFETY WARNING:
- Do NOT paste PHI into Codex, GitHub, terminal screenshots, logs, or exported files.
- This script creates STRUCTURE ONLY and inserts NO patient/task records.
- Keep all real data entry inside approved Microsoft 365 tenant processes only.

Example:
.\setup-patientfinder-v1.ps1 -SiteUrl "https://yourtenant.sharepoint.com/sites/PatientFinderLite"
.\setup-patientfinder-v1.ps1 -SiteUrl "https://yourtenant.sharepoint.com/sites/PatientFinderLite" -ClientId "00000000-0000-0000-0000-000000000000"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$SiteUrl,

    [Parameter(Mandatory = $false)]
    [string]$ClientId
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
    Write-Host "PnP.PowerShell not found." -ForegroundColor Yellow
    Write-Host "Install with: Install-Module PnP.PowerShell -Scope CurrentUser" -ForegroundColor Yellow
    throw "PnP.PowerShell module is required."
}

Import-Module PnP.PowerShell

Write-Host "Connecting to $SiteUrl ..." -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($ClientId)) {
    Connect-PnPOnline -Url $SiteUrl -Interactive
} else {
    Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId
}

function Ensure-List {
    param(
        [string]$ListTitle,
        [string]$Description
    )
    $existing = Get-PnPList -Identity $ListTitle -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "Creating list: $ListTitle" -ForegroundColor Green
        New-PnPList -Title $ListTitle -Template GenericList -OnQuickLaunch -EnableVersioning | Out-Null
        Set-PnPList -Identity $ListTitle -Description $Description | Out-Null
    } else {
        Write-Host "List already exists: $ListTitle" -ForegroundColor DarkYellow
    }
}

function Ensure-DocLibrary {
    param(
        [string]$LibraryTitle,
        [string]$Description
    )
    $existing = Get-PnPList -Identity $LibraryTitle -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "Creating document library: $LibraryTitle" -ForegroundColor Green
        New-PnPList -Title $LibraryTitle -Template DocumentLibrary -OnQuickLaunch -EnableVersioning | Out-Null
        Set-PnPList -Identity $LibraryTitle -Description $Description | Out-Null
    } else {
        Write-Host "Document library already exists: $LibraryTitle" -ForegroundColor DarkYellow
    }
}

function Ensure-Field {
    param(
        [string]$ListTitle,
        [string]$InternalName,
        [string]$DisplayName,
        [ValidateSet("Text","DateTime","Note","URL","Choice","Boolean","Number","Lookup")]
        [string]$Type,
        [string[]]$Choices = @(),
        [string]$LookupList = "",
        [string]$LookupField = "Title",
        [bool]$DateOnly = $false,
        [bool]$AddToDefaultView = $false,
        [hashtable]$ExtraValues = @{}
    )

    $field = Get-PnPField -List $ListTitle -Identity $InternalName -ErrorAction SilentlyContinue
    if ($field) {
        Write-Host "Field exists: $ListTitle.$InternalName" -ForegroundColor DarkYellow
        return
    }

    if ($Type -eq "Text") {
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type Text -AddToDefaultView:$AddToDefaultView | Out-Null
    } elseif ($Type -eq "DateTime") {
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type DateTime -AddToDefaultView:$AddToDefaultView | Out-Null
        if ($DateOnly) {
            Set-PnPField -List $ListTitle -Identity $InternalName -Values @{ DisplayFormat = 0 } | Out-Null
        }
    } elseif ($Type -eq "Note") {
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type Note -AddToDefaultView:$AddToDefaultView | Out-Null
    } elseif ($Type -eq "URL") {
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type URL -AddToDefaultView:$AddToDefaultView | Out-Null
    } elseif ($Type -eq "Choice") {
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type Choice -Choices $Choices -AddToDefaultView:$AddToDefaultView | Out-Null
    } elseif ($Type -eq "Boolean") {
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type Boolean -AddToDefaultView:$AddToDefaultView | Out-Null
    } elseif ($Type -eq "Number") {
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type Number -AddToDefaultView:$AddToDefaultView | Out-Null
    } elseif ($Type -eq "Lookup") {
        $lookupListObj = Get-PnPList -Identity $LookupList
        Add-PnPField -List $ListTitle -InternalName $InternalName -DisplayName $DisplayName -Type Lookup -LookupList $lookupListObj.Id -LookupField $LookupField -AddToDefaultView:$AddToDefaultView | Out-Null
    }

    if ($ExtraValues.Count -gt 0) {
        Set-PnPField -List $ListTitle -Identity $InternalName -Values $ExtraValues | Out-Null
    }

    Write-Host "Created field: $ListTitle.$InternalName ($Type)" -ForegroundColor Green
}

function Ensure-View {
    param(
        [string]$ListTitle,
        [string]$ViewTitle,
        [string[]]$Fields,
        [string]$Query
    )

    $view = Get-PnPView -List $ListTitle -Identity $ViewTitle -ErrorAction SilentlyContinue
    if (-not $view) {
        Write-Host "Creating view: $ListTitle -> $ViewTitle" -ForegroundColor Green
        Add-PnPView -List $ListTitle -Title $ViewTitle -Fields $Fields -Query $Query | Out-Null
    } else {
        Write-Host "View exists: $ListTitle -> $ViewTitle" -ForegroundColor DarkYellow
    }
}

function Configure-TitleField {
    param(
        [string]$ListTitle,
        [string]$TitleDisplayName,
        [bool]$TitleRequired
    )
    Set-PnPField -List $ListTitle -Identity "Title" -Values @{ Title = $TitleDisplayName; Required = $TitleRequired } | Out-Null
    Write-Host "Configured Title field for $ListTitle (Display='$TitleDisplayName', Required=$TitleRequired)" -ForegroundColor Green
}

$version1Lists = @(
    @{ Name = "PF_Patients"; Desc = "Version 1 core patient roster." },
    @{ Name = "PF_PatientCaseAssignments"; Desc = "Version 1 patient case assignment map." },
    @{ Name = "PF_PatientCompliance"; Desc = "Version 1 compliance and due-date tracking." },
    @{ Name = "PF_PatientDrugTests"; Desc = "Version 1 drug test tracking." },
    @{ Name = "PF_AttendanceSessions"; Desc = "Version 1 attendance sessions." },
    @{ Name = "PF_AttendanceSessionPatients"; Desc = "Version 1 attendance patient join." },
    @{ Name = "PF_PatientRosterDetails"; Desc = "Version 1 roster workflow details." },
    @{ Name = "PF_PatientBillingEntries"; Desc = "Version 1 billing/service entries." },
    @{ Name = "PF_PatientDocuments"; Desc = "Version 1 patient document metadata only." }
)

foreach ($l in $version1Lists) {
    Ensure-List -ListTitle $l.Name -Description $l.Desc
}

Ensure-DocLibrary -LibraryTitle "PF_Documents" -Description "PatientFinder documents library (no sample files, no demo data)."

Configure-TitleField -ListTitle "PF_Patients" -TitleDisplayName "PatientName" -TitleRequired $true
Configure-TitleField -ListTitle "PF_AttendanceSessions" -TitleDisplayName "SessionTitle" -TitleRequired $true
Configure-TitleField -ListTitle "PF_PatientBillingEntries" -TitleDisplayName "ServiceTitle" -TitleRequired $true
Configure-TitleField -ListTitle "PF_PatientCaseAssignments" -TitleDisplayName "AssignmentTitle" -TitleRequired $false
Configure-TitleField -ListTitle "PF_PatientCompliance" -TitleDisplayName "ComplianceTitle" -TitleRequired $false
Configure-TitleField -ListTitle "PF_PatientDrugTests" -TitleDisplayName "DrugTestTitle" -TitleRequired $false
Configure-TitleField -ListTitle "PF_AttendanceSessionPatients" -TitleDisplayName "AttendanceEntryTitle" -TitleRequired $false
Configure-TitleField -ListTitle "PF_PatientRosterDetails" -TitleDisplayName "RosterDetailTitle" -TitleRequired $false
Configure-TitleField -ListTitle "PF_PatientDocuments" -TitleDisplayName "DocumentMetaTitle" -TitleRequired $false
Configure-TitleField -ListTitle "PF_Documents" -TitleDisplayName "DocumentTitle" -TitleRequired $false

foreach ($l in $version1Lists) {
    $listName = $l.Name
    Ensure-Field -ListTitle $listName -InternalName "IsArchived" -DisplayName "IsArchived" -Type "Boolean" -ExtraValues @{ DefaultValue = "0" }
    Ensure-Field -ListTitle $listName -InternalName "CreatedAt" -DisplayName "CreatedAt" -Type "DateTime"
    Ensure-Field -ListTitle $listName -InternalName "UpdatedAt" -DisplayName "UpdatedAt" -Type "DateTime"
    Ensure-Field -ListTitle $listName -InternalName "CreatedByEmail" -DisplayName "CreatedByEmail" -Type "Text"
    Ensure-Field -ListTitle $listName -InternalName "UpdatedByEmail" -DisplayName "UpdatedByEmail" -Type "Text"
}

Ensure-Field -ListTitle "PF_Patients" -InternalName "PatientGuid" -DisplayName "PatientGuid" -Type "Text"
Ensure-Field -ListTitle "PF_Patients" -InternalName "MRN" -DisplayName "MRN" -Type "Text"
Ensure-Field -ListTitle "PF_Patients" -InternalName "ExternalID" -DisplayName "ExternalID" -Type "Text"
Ensure-Field -ListTitle "PF_Patients" -InternalName "Status" -DisplayName "Status" -Type "Choice" -Choices @("new","active","past","current","rss_plus","rss","former")
Ensure-Field -ListTitle "PF_Patients" -InternalName "Location" -DisplayName "Location" -Type "Text"
Ensure-Field -ListTitle "PF_Patients" -InternalName "IntakeDate" -DisplayName "IntakeDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_Patients" -InternalName "LastVisitDate" -DisplayName "LastVisitDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_Patients" -InternalName "NextApptDate" -DisplayName "NextApptDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_Patients" -InternalName "PrimaryProgram" -DisplayName "PrimaryProgram" -Type "Text"
Ensure-Field -ListTitle "PF_Patients" -InternalName "CounselorName" -DisplayName "CounselorName" -Type "Text"
Ensure-Field -ListTitle "PF_Patients" -InternalName "FlagsJson" -DisplayName "FlagsJson" -Type "Note"
Ensure-Field -ListTitle "PF_Patients" -InternalName "Priority" -DisplayName "Priority" -Type "Choice" -Choices @("Low","Normal","High","Urgent") -ExtraValues @{ DefaultValue = "Normal" }
Ensure-Field -ListTitle "PF_Patients" -InternalName "NextAction" -DisplayName "NextAction" -Type "Note"

Ensure-Field -ListTitle "PF_PatientCaseAssignments" -InternalName "Patient" -DisplayName "Patient" -Type "Lookup" -LookupList "PF_Patients"
Ensure-Field -ListTitle "PF_PatientCaseAssignments" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_PatientCaseAssignments" -InternalName "CounselorUserGuid" -DisplayName "CounselorUserGuid" -Type "Text"
Ensure-Field -ListTitle "PF_PatientCaseAssignments" -InternalName "CounselorEmail" -DisplayName "CounselorEmail" -Type "Text"
Ensure-Field -ListTitle "PF_PatientCaseAssignments" -InternalName "AssignedAt" -DisplayName "AssignedAt" -Type "DateTime"

Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "Patient" -DisplayName "Patient" -Type "Lookup" -LookupList "PF_Patients"
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "DrugTestMode" -DisplayName "DrugTestMode" -Type "Choice" -Choices @("none","weekly_count","weekday")
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "DrugTestsPerWeek" -DisplayName "DrugTestsPerWeek" -Type "Number"
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "DrugTestWeekday" -DisplayName "DrugTestWeekday" -Type "Number"
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "ProblemListDate" -DisplayName "ProblemListDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "LastProblemListReview" -DisplayName "LastProblemListReview" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "LastProblemListUpdate" -DisplayName "LastProblemListUpdate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "TreatmentPlanDate" -DisplayName "TreatmentPlanDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_PatientCompliance" -InternalName "TreatmentPlanUpdate" -DisplayName "TreatmentPlanUpdate" -Type "DateTime" -DateOnly $true

Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "DrugTestGuid" -DisplayName "DrugTestGuid" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "Patient" -DisplayName "Patient" -Type "Lookup" -LookupList "PF_Patients"
Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "TestDate" -DisplayName "TestDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "TestType" -DisplayName "TestType" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "Result" -DisplayName "Result" -Type "Choice" -Choices @("Negative","Positive","Inconclusive")
Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "Substances" -DisplayName "Substances" -Type "Note"
Ensure-Field -ListTitle "PF_PatientDrugTests" -InternalName "Notes" -DisplayName "Notes" -Type "Note"

Ensure-Field -ListTitle "PF_AttendanceSessions" -InternalName "SessionGuid" -DisplayName "SessionGuid" -Type "Text"
Ensure-Field -ListTitle "PF_AttendanceSessions" -InternalName "Kind" -DisplayName "Kind" -Type "Choice" -Choices @("Group","Individual")
Ensure-Field -ListTitle "PF_AttendanceSessions" -InternalName "SessionDate" -DisplayName "SessionDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_AttendanceSessions" -InternalName "DurationHours" -DisplayName "DurationHours" -Type "Number"
Ensure-Field -ListTitle "PF_AttendanceSessions" -InternalName "Location" -DisplayName "Location" -Type "Text"

Ensure-Field -ListTitle "PF_AttendanceSessionPatients" -InternalName "Session" -DisplayName "Session" -Type "Lookup" -LookupList "PF_AttendanceSessions"
Ensure-Field -ListTitle "PF_AttendanceSessionPatients" -InternalName "SessionGuidText" -DisplayName "SessionGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_AttendanceSessionPatients" -InternalName "Patient" -DisplayName "Patient" -Type "Lookup" -LookupList "PF_Patients"
Ensure-Field -ListTitle "PF_AttendanceSessionPatients" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_AttendanceSessionPatients" -InternalName "Status" -DisplayName "Status" -Type "Choice" -Choices @("Present","Absent","Excused")

Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "Patient" -DisplayName "Patient" -Type "Lookup" -LookupList "PF_Patients"
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "DrugOfChoiceJson" -DisplayName "DrugOfChoiceJson" -Type "Note"
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "MedicalPhysApt" -DisplayName "MedicalPhysApt" -Type "Choice" -Choices @("Needed","Scheduled","Completed")
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "MedFormStatus" -DisplayName "MedFormStatus" -Type "Choice" -Choices @("Pending","Turned in","Not needed")
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "Notes" -DisplayName "Notes" -Type "Note"
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "ReferringAgency" -DisplayName "ReferringAgency" -Type "Choice" -Choices @("Self","DCFS","Court","Other")
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "ReauthSapcDate" -DisplayName "ReauthSapcDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "MedicalEligibility" -DisplayName "MedicalEligibility" -Type "Choice" -Choices @("Yes","No","Pending")
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "MatStatus" -DisplayName "MatStatus" -Type "Choice" -Choices @("Yes","No")
Ensure-Field -ListTitle "PF_PatientRosterDetails" -InternalName "TherapyTrack" -DisplayName "TherapyTrack" -Type "Choice" -Choices @("Sandy","Becky")

Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "BillingGuid" -DisplayName "BillingGuid" -Type "Text"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "Patient" -DisplayName "Patient" -Type "Lookup" -LookupList "PF_Patients"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "Session" -DisplayName "Session" -Type "Lookup" -LookupList "PF_AttendanceSessions"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "SessionGuidText" -DisplayName "SessionGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "BillingType" -DisplayName "BillingType" -Type "Choice" -Choices @("CalOMS Discharge","CalOms Completion","Care Coordination","Crisis","Naloxone","MAT ED","Co Triage","Same Day Screening","Assessment","Intake","Problem List","Problem List Review","Problem List Update","Treatment Plan","Treatment Plan Update","Individual")
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "ServiceDate" -DisplayName "ServiceDate" -Type "DateTime" -DateOnly $true
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "StartTime" -DisplayName "StartTime" -Type "Text"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "EndTime" -DisplayName "EndTime" -Type "Text"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "TotalMinutes" -DisplayName "TotalMinutes" -Type "Number"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "Modality" -DisplayName "Modality" -Type "Choice" -Choices @("FF","Z","Z(O)","T","NA")
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "NaloxoneTraining" -DisplayName "NaloxoneTraining" -Type "Boolean"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "MatEducation" -DisplayName "MatEducation" -Type "Boolean"
Ensure-Field -ListTitle "PF_PatientBillingEntries" -InternalName "Notes" -DisplayName "Notes" -Type "Note"

Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "DocumentGuid" -DisplayName "DocumentGuid" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "Patient" -DisplayName "Patient" -Type "Lookup" -LookupList "PF_Patients"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "DocumentType" -DisplayName "DocumentType" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "OriginalFilename" -DisplayName "OriginalFilename" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "ContentType" -DisplayName "ContentType" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "ByteSize" -DisplayName "ByteSize" -Type "Number"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "SHA256" -DisplayName "SHA256" -Type "Text"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "StorageProvider" -DisplayName "StorageProvider" -Type "Choice" -Choices @("sharepoint")
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "DocumentLibraryLink" -DisplayName "DocumentLibraryLink" -Type "URL"
Ensure-Field -ListTitle "PF_PatientDocuments" -InternalName "UploadedByEmail" -DisplayName "UploadedByEmail" -Type "Text"

Ensure-Field -ListTitle "PF_Documents" -InternalName "PatientGuidText" -DisplayName "PatientGuidText" -Type "Text"
Ensure-Field -ListTitle "PF_Documents" -InternalName "DocumentType" -DisplayName "DocumentType" -Type "Text"
Ensure-Field -ListTitle "PF_Documents" -InternalName "IsArchived" -DisplayName "IsArchived" -Type "Boolean" -ExtraValues @{ DefaultValue = "0" }
Ensure-Field -ListTitle "PF_Documents" -InternalName "CreatedByEmail" -DisplayName "CreatedByEmail" -Type "Text"
Ensure-Field -ListTitle "PF_Documents" -InternalName "UpdatedByEmail" -DisplayName "UpdatedByEmail" -Type "Text"

$patientFields = @("LinkTitle","PatientGuid","Status","Priority","PrimaryProgram","NextApptDate","CounselorName","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_Patients" -ViewTitle "Active Patients" -Fields $patientFields -Query "<OrderBy><FieldRef Name='UpdatedAt' Ascending='FALSE'/></OrderBy><Where><And><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq><Or><Eq><FieldRef Name='Status'/><Value Type='Choice'>active</Value></Eq><Eq><FieldRef Name='Status'/><Value Type='Choice'>current</Value></Eq></Or></And></Where>"
Ensure-View -ListTitle "PF_Patients" -ViewTitle "High Priority" -Fields $patientFields -Query "<OrderBy><FieldRef Name='UpdatedAt' Ascending='FALSE'/></OrderBy><Where><And><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq><Or><Eq><FieldRef Name='Priority'/><Value Type='Choice'>High</Value></Eq><Eq><FieldRef Name='Priority'/><Value Type='Choice'>Urgent</Value></Eq></Or></And></Where>"
Ensure-View -ListTitle "PF_Patients" -ViewTitle "Due This Week" -Fields $patientFields -Query "<OrderBy><FieldRef Name='NextApptDate' Ascending='TRUE'/></OrderBy><Where><And><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq><And><Geq><FieldRef Name='NextApptDate'/><Value IncludeTimeValue='FALSE' Type='DateTime'><Today /></Value></Geq><Leq><FieldRef Name='NextApptDate'/><Value IncludeTimeValue='FALSE' Type='DateTime'><Today OffsetDays='7' /></Value></Leq></And></And></Where>"

$complianceFields = @("LinkTitle","Patient","DrugTestMode","LastProblemListReview","TreatmentPlanUpdate","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_PatientCompliance" -ViewTitle "Overdue Compliance" -Fields $complianceFields -Query "<OrderBy><FieldRef Name='UpdatedAt' Ascending='FALSE'/></OrderBy><Where><And><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq><Or><Lt><FieldRef Name='LastProblemListReview'/><Value IncludeTimeValue='FALSE' Type='DateTime'><Today /></Value></Lt><Lt><FieldRef Name='TreatmentPlanUpdate'/><Value IncludeTimeValue='FALSE' Type='DateTime'><Today /></Value></Lt></Or></And></Where>"

$drugFields = @("LinkTitle","Patient","TestDate","TestType","Result","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_PatientDrugTests" -ViewTitle "Recent Drug Tests" -Fields $drugFields -Query "<OrderBy><FieldRef Name='TestDate' Ascending='FALSE'/></OrderBy><Where><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq></Where>"

$sessionFields = @("LinkTitle","SessionGuid","Kind","SessionDate","DurationHours","Location","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_AttendanceSessions" -ViewTitle "Recent Sessions" -Fields $sessionFields -Query "<OrderBy><FieldRef Name='SessionDate' Ascending='FALSE'/></OrderBy><Where><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq></Where>"

$attendJoinFields = @("LinkTitle","Session","SessionGuidText","Patient","PatientGuidText","Status","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_AttendanceSessionPatients" -ViewTitle "Attendance Records" -Fields $attendJoinFields -Query "<OrderBy><FieldRef Name='UpdatedAt' Ascending='FALSE'/></OrderBy><Where><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq></Where>"

$rosterFields = @("LinkTitle","Patient","MedicalPhysApt","MedFormStatus","ReauthSapcDate","MedicalEligibility","MatStatus","TherapyTrack","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_PatientRosterDetails" -ViewTitle "Roster Workflow" -Fields $rosterFields -Query "<OrderBy><FieldRef Name='UpdatedAt' Ascending='FALSE'/></OrderBy><Where><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq></Where>"

$billingFields = @("LinkTitle","Patient","BillingType","ServiceDate","TotalMinutes","Modality","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_PatientBillingEntries" -ViewTitle "Recent Billing Entries" -Fields $billingFields -Query "<OrderBy><FieldRef Name='ServiceDate' Ascending='FALSE'/></OrderBy><Where><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq></Where>"
Ensure-View -ListTitle "PF_PatientBillingEntries" -ViewTitle "This Week Billing" -Fields $billingFields -Query "<OrderBy><FieldRef Name='ServiceDate' Ascending='TRUE'/></OrderBy><Where><And><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq><And><Geq><FieldRef Name='ServiceDate'/><Value IncludeTimeValue='FALSE' Type='DateTime'><Today /></Value></Geq><Leq><FieldRef Name='ServiceDate'/><Value IncludeTimeValue='FALSE' Type='DateTime'><Today OffsetDays='7' /></Value></Leq></And></And></Where>"

$docMetaFields = @("LinkTitle","Patient","DocumentType","OriginalFilename","DocumentLibraryLink","UploadedByEmail","UpdatedAt","IsArchived")
Ensure-View -ListTitle "PF_PatientDocuments" -ViewTitle "Document Metadata" -Fields $docMetaFields -Query "<OrderBy><FieldRef Name='UpdatedAt' Ascending='FALSE'/></OrderBy><Where><Eq><FieldRef Name='IsArchived'/><Value Type='Boolean'>0</Value></Eq></Where>"

$libraryFields = @("LinkFilename","PatientGuidText","DocumentType","Created","Modified","IsArchived")
Ensure-View -ListTitle "PF_Documents" -ViewTitle "PatientFinder Documents" -Fields $libraryFields -Query "<OrderBy><FieldRef Name='Modified' Ascending='FALSE'/></OrderBy>"

Write-Host ""
Write-Host "Verification: list/library item counts" -ForegroundColor Cyan

$allContainers = @(
    "PF_Patients",
    "PF_PatientCaseAssignments",
    "PF_PatientCompliance",
    "PF_PatientDrugTests",
    "PF_AttendanceSessions",
    "PF_AttendanceSessionPatients",
    "PF_PatientRosterDetails",
    "PF_PatientBillingEntries",
    "PF_PatientDocuments",
    "PF_Documents"
)

$allZero = $true
foreach ($name in $allContainers) {
    $obj = Get-PnPList -Identity $name
    $count = $obj.ItemCount
    if ($count -ne 0) { $allZero = $false }
    Write-Host ("{0} => ItemCount: {1}" -f $name, $count)
}

if ($allZero) {
    Write-Host "CONFIRMED: all item counts are 0." -ForegroundColor Green
} else {
    Write-Host "WARNING: one or more lists/libraries have items." -ForegroundColor Yellow
}

Write-Host "Done." -ForegroundColor Green
Write-Host "Reminder: Keep PHI out of logs/chats/screenshots/exports." -ForegroundColor Yellow
