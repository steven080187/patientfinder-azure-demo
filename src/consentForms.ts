export type ConsentForm = {
  id: string;         // matches the formId recorded in consents.events (e.g. "begin", "whoweare")
  dataKey: string;    // key in consents.dataByForm (e.g. "beginData_v1")
  title: string;
  body: string;       // plain-text content shown in the print view
};

export const CONSENT_FORMS: ConsentForm[] = [
  {
    id: "begin",
    dataKey: "beginData_v1",
    title: "Consent Forms — Signing Acknowledgment",
    body: `During this intake, you will review several required forms related to your care, privacy, and participation in the program.

You will sign once here. As you review each form, you will acknowledge it and your signature will be applied with the date and time.

These documents are not considered complete or binding until reviewed and signed by a counselor at your first appointment.

I understand how the signing process works and agree to proceed.`,
  },
  {
    id: "whoweare",
    dataKey: "whoweareData_v1",
    title: "About NCADD-SFV",
    body: `WHO WE ARE
NCADD-SFV (National Council on Alcoholism and Drug Dependence – San Fernando Valley) is a non-profit organization dedicated to providing comprehensive substance use disorder treatment services in the San Fernando Valley and surrounding communities.

OUR MISSION
We provide evidence-based, client-centered treatment for individuals and families affected by substance use disorders. Our services are designed to support recovery, promote wellness, and reduce the harm associated with alcohol and drug use.

SERVICES OFFERED
NCADD-SFV provides a range of services including:
• Outpatient counseling (individual and group)
• Intensive outpatient programs (IOP)
• Case management and care coordination
• Medication-assisted treatment (MAT)
• Recovery support services
• Prevention and education

YOUR RIGHTS AS A CLIENT
You have the right to receive quality treatment in a respectful and safe environment. You have the right to participate in your treatment planning, to be informed about your diagnosis and treatment options, and to refuse treatment. You also have the right to file grievances and to have your confidentiality protected according to state and federal law.

YOUR RESPONSIBILITIES
As a client of NCADD-SFV, you are expected to:
• Attend scheduled appointments or notify staff in advance of absences
• Participate actively in your treatment
• Treat staff and other clients with respect
• Follow program rules and guidelines
• Provide accurate information about your health and substance use
• Maintain active Medi-Cal eligibility (if applicable)

I acknowledge that I have reviewed and understand the information above.`,
  },
  {
    id: "confidentiality",
    dataKey: "confidentialityData_v1",
    title: "Confidentiality & Limits of Confidentiality",
    body: `CONFIDENTIALITY OF RECORDS
Records related to participation in alcohol and drug treatment services at NCADD-SFV are protected by federal law and regulations, including 42 CFR Part 2. Generally, NCADD-SFV may not disclose information that identifies an individual as having participated in substance use disorder treatment without the client's written consent.

USE AND STORAGE OF INFORMATION
NCADD-SFV maintains client records in secure electronic health record systems. Information may be documented electronically, including the use of secure technology to assist staff in creating accurate clinical documentation. Access to records is limited to authorized personnel and protected in accordance with federal and state confidentiality requirements.

PERMITTED DISCLOSURES WITHOUT CONSENT
Federal law allows disclosure of confidential information without written consent only in limited circumstances, including:
• Medical emergencies
• Valid court orders
• Qualified personnel for research, audit, or program evaluation

MANDATORY REPORTING & SAFETY EXCEPTIONS
Confidentiality does not apply in situations where staff are legally required to make a report under California law, including:
• Suspected child abuse or neglect
• Suspected elder or dependent adult abuse
• Credible threats of harm to self or others
• Medical emergencies

In these situations, staff are required to notify the appropriate person or agency.

VIOLATIONS
Violation of federal confidentiality laws and regulations by a program is a crime. Suspected violations may be reported to appropriate authorities in accordance with federal regulations.

I acknowledge that I have read and understand the confidentiality protections and limits described above.`,
  },
  {
    id: "payment",
    dataKey: "paymentData_v1",
    title: "Payment & Financial Responsibility (Medi-Cal)",
    body: `NCADD-SFV provides substance use disorder treatment services funded through Medi-Cal. Services are billed to Medi-Cal based on eligibility and authorization.

I understand that I must maintain active Medi-Cal eligibility in order for services to be covered. I agree to notify NCADD-SFV staff immediately of any changes to my Medi-Cal status, insurance coverage, or personal information that may affect eligibility.

I understand that if my Medi-Cal coverage is discontinued, suspended, or denied for any reason, I may be financially responsible for services provided during periods of ineligibility.

I understand that NCADD-SFV may suspend or discontinue services if Medi-Cal eligibility cannot be verified or if coverage is denied.

I acknowledge that I have read and understand the Medi-Cal payment and financial responsibility information described above.`,
  },
  {
    id: "abuse",
    dataKey: "abuseData_v1",
    title: "Child & Elder Abuse Reporting Procedure",
    body: `CHILD ABUSE REPORTING
Patient understands that Section 11166 of the Penal Code requires that all alcohol treatment facilities employees who have knowledge of, or who observe a child in a professional capacity (or within the scope of employment), whom employee knows or reasonably believes has been the victim of child abuse, must report the known or suspected instance of child abuse to a child abuse protective agency immediately or as soon as practically possible by telephone.

Hotline: 800-540-400
Telephone: 213-351-5601
Written report must be prepared and sent within 36 hours of receiving information.

ELDER ABUSE REPORTING
When an alcohol program employee knows or suspects that a dependent adult has been abused or neglected, employee shall take the following actions:
1. Telephone the Department of Public Social Services (DPSS) Adult Protective Services Division, or the law enforcement agency with jurisdiction.
2. Hotline: 800-992-1660
3. Submit a written report within 36 hours using Form No. PA 1980.

I acknowledge that I have reviewed and understand the information above.`,
  },
  {
    id: "telehealth",
    dataKey: "telehealthData_v1",
    title: "Telehealth Informed Consent",
    body: `WHAT IS TELEHEALTH?
Telehealth involves the use of secure electronic audio and video communication to provide substance use disorder counseling, consultation, treatment, referrals, education, and clinical services.

CONFIDENTIALITY & PRIVACY
The same laws that protect the confidentiality of in-person services apply to telehealth, including mandatory reporting requirements such as suspected child, elder, or dependent adult abuse, credible threats of harm, or medical emergencies.

RISKS & LIMITATIONS
While NCADD-SFV uses secure, encrypted platforms, telehealth may involve risks including technical failures, interruptions, or unauthorized access despite reasonable safeguards.

YOUR RIGHTS
• You may withdraw consent to telehealth at any time.
• You may request in-person services when available.
• You may access your medical records as permitted by law.
• Telehealth is not appropriate for emergencies. Call 911 if needed.

I acknowledge that I have reviewed and understand the information above.`,
  },
  {
    id: "billofrights",
    dataKey: "billofrightsData_v1",
    title: "Client Bill of Rights",
    body: `All clients enrolled in NCADD-SFV's substance use disorder outpatient or intensive outpatient treatment program have the following rights as specified in California Department of Health Care Services Alcohol and/or Other Drug Program Certification Standards.

1. To be treated with honesty, respect, dignity, and privacy.
2. To be informed of all aspects of recommended treatment, including risks and alternatives.
3. To receive services from qualified staff.
4. To receive evidence-based treatment.
5. To receive appropriate care for co-occurring conditions when authorized.
6. To participate in the development and review of one's treatment plan.
7. To remain in treatment for as long as the provider is authorized to treat the client.
8. To receive support and education for families and loved ones when authorized.
9. To receive care in a safe and ethical treatment setting.
10. To be free from abuse, exploitation, coercion, and restraint.
11. To take medications prescribed by a licensed medical professional.
12. To consult with independent treatment specialists or legal counsel at one's own expense.
13. To confidentiality of communications and personal identifying information as allowed by law.
14. To access one's own client record according to program procedures.
15. To be informed of reasons for termination or denial of services.
16. To be free from discrimination.
17. To know the cost of services.
18. To be informed of these rights at enrollment.
19. To be informed of complaint procedures and how to contact oversight agencies.

If you believe any of your rights have been violated and the issue cannot be resolved with program management, you may contact the California Department of Health Care Services or Los Angeles County Substance Abuse Prevention and Control.

I acknowledge that I have been advised of and received a copy of my Client Bill of Rights.`,
  },
  {
    id: "personalrights",
    dataKey: "personalrightsData_v1",
    title: "Client Personal Rights",
    body: `All clients enrolled in NCADD-SFV's substance use disorder outpatient or intensive outpatient program have the following rights as specified in California Department of Health Care Services Alcohol and/or Other Drug Program Certification Standards.

1. The right to confidentiality of communications and personal identifying information within the limitations and requirements for disclosure of client information as provided for in HIPAA, Title 42, Code of Federal Regulations, Part 2, as well as all other state and federal laws and regulations.

2. The right to be accorded dignity in contact with staff, volunteers, board members, and other people.

3. The right to be accorded safe, healthful, and comfortable accommodations to meet needs.

4. The right to be free from verbal, emotional, and physical abuse and/or inappropriate sexual behavior.

5. The right to be informed by the program of procedures to file a grievance or appeal a discharge.

6. The right to be free from discrimination based on ethnic group identification, religion, age, gender, race, sexual orientation, or disability.

7. The right to access the client record according to program procedures.

8. The right to take medications prescribed by a licensed medical professional for medical, mental health, or substance-related conditions.

I acknowledge that I have been advised of and received a copy of my Client Personal Rights.`,
  },
  {
    id: "codesofconduct",
    dataKey: "codesofconductData_v1",
    title: "Codes of Conduct & Program Expectations",
    body: `CLIENT CODE OF CONDUCT
Clients are expected to:
1. Treat staff and volunteers with respect and honesty.
2. Refrain from discriminatory or derogatory language or behavior, including sexism, racism, homophobia, biphobia, and transphobia.
3. Inform staff of needs and changes in circumstances to receive appropriate services.
4. Provide advance notice when requesting services to allow timely coordination.
5. Maintain confidentiality of other clients, patients, and staff.
6. Understand that staff may not be available on a drop-in basis and appointments may be required.
7. Address concerns or problems in a mature and respectful manner according to program policies.
8. Understand that harassing, bullying, or defamatory social media activity involving NCADD-SFV staff or clients is unacceptable.
9. Adhere to Group Guidelines provided during intake.
10. Adhere to the Toxicology Testing Policy provided during intake.
11. Adhere to the Admission Agreement provided during intake.

PROGRAM CODE OF CONDUCT & BOUNDARIES
The following program rules and boundaries apply to participation in NCADD-SFV services:
1. Use of alcohol or illegal drugs on program premises or while representing NCADD-SFV is strictly prohibited.
2. Impairment related to substance use that affects participation or conduct is prohibited.
3. Personal or sexual relationships between staff and active clients are strictly prohibited.
4. Sexual harassment between participants or toward staff is prohibited.
5. Unlawful discrimination is prohibited.
6. Conflicts of interest or personal or financial gain are prohibited.
7. Breach of confidentiality of participants is prohibited.
8. Verbal, emotional, or physical abuse is prohibited.

I acknowledge that I have reviewed and understand the Client Code of Conduct and the Program Code of Conduct and program boundaries.`,
  },
  {
    id: "grievance",
    dataKey: "grievanceData_v1",
    title: "Grievance & Complaint Policy",
    body: `You have the right to file a grievance or complaint if you believe you have been treated unfairly, discriminated against, or if you are dissatisfied with services received.

WHAT IS A GRIEVANCE?
A grievance is a concern or complaint related to services, access, staff conduct, discrimination, quality of care, or client rights. Grievances may be filed verbally or in writing and must be submitted within sixty (60) days of the incident.

EXAMPLES INCLUDE:
• Problems with services or access to care
• Staff conduct or customer service issues
• Denial of services, referrals, or appointments
• Quality or appropriateness of care
• Billing or fee concerns
• Violation of client rights

HOW TO FILE A GRIEVANCE
1. As soon as possible, present the grievance verbally or in writing to the Director of Clinical Services, clearly stating that it is a formal grievance.
2. The Director of Clinical Services will investigate the complaint and notify the County Contract Program Auditor within forty-eight (48) hours.
3. Every effort will be made to resolve the grievance within ten (10) working days.
4. If unresolved, the grievance may be submitted in writing to the President of the Board of Directors of NCADD-SFV.
5. If still unresolved, the grievance may be appealed to Los Angeles County SAPC and, if necessary, the California Department of Health Care Services.

I acknowledge that I have received and understand the Grievance & Complaint Policy, including how to file a grievance and my right to appeal.`,
  },
  {
    id: "privacy",
    dataKey: "privacyData_v1",
    title: "Notice of Privacy Practices",
    body: `The County of Los Angeles requires that all participants enrolled in drug and alcohol treatment programs be informed of the Los Angeles County Health Agency Notice of Privacy Practices.

This notice explains how medical information about you may be used and disclosed and how you can access this information.

I acknowledge that I have received information regarding the Los Angeles County Health Agency Notice of Privacy Practices.`,
  },
  {
    id: "education",
    dataKey: "educationData_v1",
    title: "Acknowledgment of Required Education",
    body: `Los Angeles County requires that individuals enrolled in alcohol and drug treatment programs receive education on specific health, safety, and recovery-related topics. Some material may include discussion of medical conditions or behaviors that may be sensitive.

THE FOLLOWING EDUCATION TOPICS ARE PROVIDED TO ALL PARTICIPANTS:
• HIV/AIDS education
• Tuberculosis education
• Viral Hepatitis A, B, and C education
• Smoking cessation education
• Communicable diseases (STIs/STDs) education
• Parenting and stress education
• Naloxone education
• Medication Assisted Treatment (MAT) education
• Perinatal education, when applicable

I acknowledge that, at the conclusion of this intake, I will be provided access to educational materials covering the topics listed above in downloadable format. I understand that I will have the opportunity to review this information, ask questions, and request additional clarification, resources, or referrals as needed.`,
  },
  {
    id: "toxicology",
    dataKey: "toxicologyData_v1",
    title: "Patient Toxicology (Drug Testing) Agreement",
    body: `PURPOSE OF TOXICOLOGY TESTING
Toxicology testing (also known as drug testing or urinalysis) may be used by NCADD-SFV as a clinical tool to support your individualized treatment plan. Testing helps guide conversations with your counselor about substance use, triggers, progress toward goals, and harm-reduction supports. Testing is not used as punishment.

TESTING PROCESS
Testing is conducted in a manner that prioritizes safety, privacy, accuracy, and respect. Testing may include urine or saliva screening and may occur randomly, for cause, or based on requirements from referring agencies such as DCFS, probation, or the court.

Substances that may be screened include, but are not limited to:
• Alcohol, Marijuana, Cocaine
• Opiates, Fentanyl, Methadone, Oxycodone
• Amphetamines, Methamphetamines
• Benzodiazepines, Barbiturates, Buprenorphine

YOUR RIGHTS
• You will only be tested after providing consent.
• You may discuss how testing relates to your treatment goals with your counselor.
• You may ask questions about how results are used in your treatment planning.

CONFIDENTIALITY
Test results are confidential and protected under federal and state law, including 42 CFR Part 2 and HIPAA. Results are shared only with you and your treatment team unless you authorize disclosure through a Release of Information.

I acknowledge that I have read and understand the Patient Toxicology Agreement and voluntarily consent to toxicology testing as part of my treatment.`,
  },
  {
    id: "followup",
    dataKey: "followupData_v1",
    title: "Consent for Follow-Up Contact",
    body: `I understand that the National Council on Alcoholism and Drug Dependence – San Fernando Valley (NCADD-SFV) may conduct periodic follow-up contacts to determine my current status and treatment needs.

I understand that follow-up contact may occur for a period of up to one (1) year after completion of the program, and that referrals will be offered if needed.

I acknowledge that I have reviewed and understand this information.`,
  },
  {
    id: "ai",
    dataKey: "aiData_v1",
    title: "Authorization for Use of AI Technology (Plaud Device)",
    body: `PURPOSE
NCADD-SFV uses Plaud AI devices (audio recording pins) as a tool to assist clinical staff in documenting accurate and timely progress notes for the outpatient program. This authorization allows NCADD-SFV staff to use Plaud AI devices during clinical sessions.

INFORMATION TO BE RECORDED
The Plaud AI device may capture spoken clinical discussions between patient and authorized NCADD-SFV staff for the sole purpose of generating written progress notes. Recordings will:
• Be securely transferred to NCADD-SFV's electronic health record system.
• Be used only for progress note creation and not retained beyond necessary documentation processes.
• Be deleted once the progress note has been completed.

RECIPIENTS
The information recorded using Plaud AI devices will be accessed only by:
• Authorized NCADD-SFV clinical and administrative staff.
• Authorized third-party vendors contracted to provide transcription or technical support services under HIPAA-compliant Business Associate Agreements.

PATIENT RIGHTS & DISCLOSURES
• Participation is voluntary. Patient may refuse or revoke this authorization at any time by submitting a written request to NCADD-SFV's Clinical Program Supervisor.
• Refusal to sign will not impact patient ability to receive services from NCADD-SFV.
• Recordings are used solely for documentation purposes and are not part of patient permanent health record.
• Plaud AI devices and associated processes comply with HIPAA and 42 CFR Part 2 confidentiality requirements.

ACKNOWLEDGEMENT
By signing below, patient acknowledges having read and understood this authorization and agrees to allow NCADD-SFV to use Plaud AI devices for documenting progress notes.`,
  },
  {
    id: "handbook",
    dataKey: "handbookData_v1",
    title: "Patient Handbook & Orientation",
    body: `Los Angeles County SAPC requires that patients are informed about their treatment benefits, rights, and complaint procedures.

PATIENT HANDBOOK
The Patient Handbook explains your substance use disorder treatment benefits under Los Angeles County's Substance Use Disorder Specialty Care Plan.

ACKNOWLEDGMENT
By signing below, I acknowledge that:
• I was informed about my substance use disorder treatment benefits under the County Plan.
• I was provided access to the Patient Handbook and informed how to obtain a copy.
• I viewed or was shown the required Patient Orientation video.
• I understand my rights, including the right to file a grievance or appeal without it negatively affecting my treatment.

I acknowledge that I have reviewed and understand this information.`,
  },
];
